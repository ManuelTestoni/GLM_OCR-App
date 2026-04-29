import os
import base64
import tempfile
from pathlib import Path

import httpx
import fitz  # pymupdf
from fastapi import FastAPI, UploadFile, File, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "glm-ocr:latest"
OCR_PROMPT = (
    "You are a precise document OCR assistant. "
    "Convert the content of this document page to clean Markdown. "
    "Preserve all structure: headings, paragraphs, bullet lists, numbered lists, "
    "tables (use GFM pipe tables), code blocks (with language tags), "
    "mathematical formulas, figure captions, footnotes. "
    "Do NOT add explanations, preambles or trailing comments. "
    "Output only the raw Markdown text."
)

app = FastAPI(title="GLM-OCR Web App")

sessions: dict = {}


def pdf_to_images(pdf_path: str, dpi: int = 150) -> list[str]:
    doc = fitz.open(pdf_path)
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    out_dir = Path(pdf_path).parent
    paths = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=mat)
        img_path = str(out_dir / f"page_{i:04d}.png")
        pix.save(img_path)
        paths.append(img_path)
    doc.close()
    return paths


def img_to_b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    fname = file.filename or "upload"
    ext = Path(fname).suffix.lower()
    supported = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}
    if ext not in supported:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    tmp_dir = tempfile.mkdtemp(prefix="glmocr_")
    file_path = os.path.join(tmp_dir, fname)
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    if ext == ".pdf":
        pages = pdf_to_images(file_path, dpi=150)
    else:
        pages = [file_path]

    session_id = os.path.basename(tmp_dir)
    sessions[session_id] = {
        "pages": pages,
        "ocr": [""] * len(pages),
        "source_name": fname,
        "tmp_dir": tmp_dir,
    }
    return {"session_id": session_id, "page_count": len(pages)}


@app.get("/api/page/{session_id}/{page_num}")
async def get_page(session_id: str, page_num: int):
    sess = _get_sess(session_id)
    if page_num < 0 or page_num >= len(sess["pages"]):
        raise HTTPException(404, "Page out of range")
    return FileResponse(sess["pages"][page_num], media_type="image/png")


@app.post("/api/ocr/{session_id}/{page_num}")
async def ocr_page(session_id: str, page_num: int):
    sess = _get_sess(session_id)
    if page_num < 0 or page_num >= len(sess["pages"]):
        raise HTTPException(404, "Page out of range")

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": OCR_PROMPT,
        "images": [img_to_b64(sess["pages"][page_num])],
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(OLLAMA_URL, json=payload)
            resp.raise_for_status()
    except httpx.ConnectError:
        raise HTTPException(503, "Cannot connect to Ollama. Make sure it is running on localhost:11434.")
    except httpx.TimeoutException:
        raise HTTPException(504, "OCR request timed out (5 min). Try a simpler page first.")
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Ollama error {e.response.status_code}: {e.response.text[:200]}")

    data = resp.json()
    markdown = data.get("response", "").strip()
    sess["ocr"][page_num] = markdown
    return {"markdown": markdown, "page": page_num}


@app.get("/api/status/{session_id}")
async def get_status(session_id: str):
    sess = _get_sess(session_id)
    return {
        "page_count": len(sess["pages"]),
        "processed": [bool(r) for r in sess["ocr"]],
        "source_name": sess["source_name"],
    }


@app.post("/api/save/{session_id}")
async def save_markdown(session_id: str, body: dict = Body(...)):
    sess = _get_sess(session_id)
    markdown = body.get("markdown") or "\n\n---\n\n".join(p for p in sess["ocr"])
    out_path = body.get("output_path", "")

    if not out_path:
        stem = Path(sess["source_name"]).stem
        out_path = os.path.join(sess["tmp_dir"], f"{stem}.md")

    out_path = os.path.expanduser(out_path)
    out_dir = os.path.dirname(out_path)
    if out_dir and not os.path.isdir(out_dir):
        raise HTTPException(400, f"Directory does not exist: {out_dir}")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(markdown)
    return {"saved_to": out_path}


@app.get("/api/download/{session_id}")
async def download_markdown(session_id: str):
    sess = _get_sess(session_id)
    stem = Path(sess["source_name"]).stem
    combined = "\n\n---\n\n".join(p for p in sess["ocr"] if p)
    out_path = os.path.join(sess["tmp_dir"], f"{stem}.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(combined)
    return FileResponse(out_path, filename=f"{stem}.md", media_type="text/markdown")


def _get_sess(session_id: str) -> dict:
    sess = sessions.get(session_id)
    if not sess:
        raise HTTPException(404, "Session not found")
    return sess


app.mount("/", StaticFiles(directory=str(Path(__file__).parent / "static"), html=True), name="static")
