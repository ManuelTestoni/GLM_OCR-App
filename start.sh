#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Create virtualenv if missing
if [ ! -d ".venv" ]; then
  echo "→ Creating virtual environment…"
  python3 -m venv .venv
fi

source .venv/bin/activate

# Install / upgrade deps silently if needed
pip install -q -r requirements.txt

echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │  GLM-OCR Web App                        │"
echo "  │  Open http://localhost:8000 in browser  │"
echo "  └─────────────────────────────────────────┘"
echo ""
echo "  Make sure Ollama is running:  ollama serve"
echo "  Model required:               ollama pull glm-ocr:latest"
echo ""

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
