/* ── State ───────────────────────────────────────────────── */
const state = {
  sessionId: null,
  pageCount: 0,
  currentPage: 0,
  ocrResults: [],    // markdown string per page
  sourceName: "",
  activeTab: "rendered",
  isProcessing: false,
  stopRequested: false,
};

/* ── DOM refs ────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const dom = {
  fileInput:      $("file-input"),
  openBtn:        $("open-btn"),
  ocrPageBtn:     $("ocr-page-btn"),
  ocrAllBtn:      $("ocr-all-btn"),
  stopBtn:        $("stop-btn"),
  saveBtn:        $("save-btn"),
  copyBtn:        $("copy-btn"),
  prevBtn:        $("prev-btn"),
  nextBtn:        $("next-btn"),
  pageInfo:       $("page-info"),
  pageOcrBadge:   $("page-ocr-badge"),
  docPlaceholder: $("doc-placeholder"),
  docContainer:   $("doc-container"),
  pageImg:        $("page-img"),
  mdPlaceholder:  $("md-placeholder"),
  mdRendered:     $("md-rendered"),
  mdRaw:          $("md-raw"),
  statusMsg:      $("status-msg"),
  progressTrack:  $("progress-track"),
  progressFill:   $("progress-fill"),
  progressLabel:  $("progress-label"),
  dropOverlay:    $("drop-overlay"),
  savePopup:      $("save-popup"),
  savePathInput:  $("save-path-input"),
  saveCancelBtn:  $("save-cancel-btn"),
  saveConfirmBtn: $("save-confirm-btn"),
};

/* ── Marked config ───────────────────────────────────────── */
function renderMarkdown(text) {
  if (typeof marked === "undefined") return `<pre>${escHtml(text)}</pre>`;
  return marked.parse(text, { gfm: true, breaks: false });
}
function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/* ── Status helpers ──────────────────────────────────────── */
function setStatus(msg, type = "") {
  dom.statusMsg.textContent = msg;
  dom.statusMsg.className = type;
}
function showProgress(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  dom.progressTrack.style.display = "block";
  dom.progressLabel.style.display = "block";
  dom.progressFill.style.width = pct + "%";
  dom.progressLabel.textContent = `${done} / ${total}`;
}
function hideProgress() {
  dom.progressTrack.style.display = "none";
  dom.progressLabel.style.display = "none";
}

/* ── File upload ─────────────────────────────────────────── */
dom.openBtn.addEventListener("click", () => dom.fileInput.click());
dom.fileInput.addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) handleFile(file);
  dom.fileInput.value = "";
});

async function handleFile(file) {
  setStatus(`Uploading "${file.name}"…`);
  const fd = new FormData();
  fd.append("file", file);
  try {
    const resp = await fetch("/api/upload", { method: "POST", body: fd });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || resp.statusText);
    }
    const data = await resp.json();
    state.sessionId = data.session_id;
    state.pageCount = data.page_count;
    state.currentPage = 0;
    state.ocrResults = Array(data.page_count).fill("");
    state.sourceName = file.name;

    dom.ocrPageBtn.disabled = false;
    dom.ocrAllBtn.disabled = false;
    dom.prevBtn.disabled = false;
    dom.nextBtn.disabled = false;

    await loadPage(0);
    setStatus(`"${file.name}" loaded – ${data.page_count} page(s). Ready to OCR.`);
  } catch (err) {
    setStatus("Upload error: " + err.message, "error");
  }
}

/* ── Page navigation ─────────────────────────────────────── */
dom.prevBtn.addEventListener("click", () => navigatePage(-1));
dom.nextBtn.addEventListener("click", () => navigatePage(1));

function navigatePage(delta) {
  const next = state.currentPage + delta;
  if (next < 0 || next >= state.pageCount) return;
  loadPage(next);
}

async function loadPage(pageNum) {
  state.currentPage = pageNum;
  updatePageInfo();

  // Load image
  dom.docPlaceholder.style.display = "none";
  dom.docContainer.style.display = "flex";
  dom.pageImg.src = `/api/page/${state.sessionId}/${pageNum}?t=${Date.now()}`;

  // Update markdown panel
  showPageMarkdown(pageNum);
}

function updatePageInfo() {
  dom.pageInfo.textContent = `${state.currentPage + 1} / ${state.pageCount}`;
  dom.prevBtn.disabled = state.currentPage === 0 || state.isProcessing;
  dom.nextBtn.disabled = state.currentPage === state.pageCount - 1 || state.isProcessing;
  updateOcrBadge(state.currentPage);
}

function updateOcrBadge(pageNum) {
  const badge = dom.pageOcrBadge;
  badge.style.display = "inline-flex";
  const result = state.ocrResults[pageNum];
  if (result) {
    badge.className = "page-badge done";
    badge.textContent = "✓ done";
  } else {
    badge.className = "page-badge pending";
    badge.textContent = "pending";
  }
}

/* ── Markdown display ────────────────────────────────────── */
function showPageMarkdown(pageNum) {
  const md = state.ocrResults[pageNum] || "";
  if (!md) {
    dom.mdPlaceholder.style.display = "flex";
    dom.mdRendered.style.display = "none";
    dom.mdRaw.style.display = "none";
    return;
  }
  dom.mdPlaceholder.style.display = "none";
  applyTab(state.activeTab, md);
}

function applyTab(tab, md) {
  if (tab === "rendered") {
    dom.mdRendered.style.display = "block";
    dom.mdRaw.style.display = "none";
    dom.mdRendered.innerHTML = renderMarkdown(md);
  } else {
    dom.mdRendered.style.display = "none";
    dom.mdRaw.style.display = "block";
    dom.mdRaw.value = md;
  }
}

document.querySelectorAll(".md-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".md-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.activeTab = tab.dataset.tab;

    // Sync raw edits back before switching
    if (state.activeTab === "rendered") {
      const edited = dom.mdRaw.value;
      if (state.sessionId && edited !== undefined) {
        state.ocrResults[state.currentPage] = edited;
      }
    }
    const md = state.ocrResults[state.currentPage] || "";
    if (md) {
      dom.mdPlaceholder.style.display = "none";
      applyTab(state.activeTab, md);
    }
  });
});

// Save raw edits when typing
dom.mdRaw.addEventListener("input", () => {
  if (state.sessionId !== null) {
    state.ocrResults[state.currentPage] = dom.mdRaw.value;
    updateSaveBtn();
  }
});

/* ── OCR ─────────────────────────────────────────────────── */
dom.ocrPageBtn.addEventListener("click", () => ocrPage(state.currentPage));
dom.ocrAllBtn.addEventListener("click", ocrAllPages);
dom.stopBtn.addEventListener("click", () => {
  state.stopRequested = true;
  setStatus("Stopping after current page…", "");
});

async function ocrPage(pageNum) {
  if (!state.sessionId) return;
  setProcessing(true);
  setBadgeProcessing(pageNum);
  setStatus(`Running OCR on page ${pageNum + 1}…`);

  try {
    const resp = await fetch(`/api/ocr/${state.sessionId}/${pageNum}`, { method: "POST" });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || resp.statusText);
    }
    const data = await resp.json();
    state.ocrResults[pageNum] = data.markdown;
    if (state.currentPage === pageNum) showPageMarkdown(pageNum);
    updateOcrBadge(pageNum);
    updateSaveBtn();
    setStatus(`Page ${pageNum + 1} done.`, "success");
  } catch (err) {
    setStatus("OCR error: " + err.message, "error");
  } finally {
    setProcessing(false);
  }
}

async function ocrAllPages() {
  if (!state.sessionId) return;
  state.stopRequested = false;
  setProcessing(true);
  let done = 0;
  showProgress(0, state.pageCount);

  for (let i = 0; i < state.pageCount; i++) {
    if (state.stopRequested) {
      setStatus(`Stopped at page ${i + 1}.`);
      break;
    }
    setBadgeProcessingFor(i);
    setStatus(`OCR page ${i + 1} / ${state.pageCount}…`);
    try {
      const resp = await fetch(`/api/ocr/${state.sessionId}/${i}`, { method: "POST" });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(`Page ${i+1}: ${err.detail || resp.statusText}`);
      }
      const data = await resp.json();
      state.ocrResults[i] = data.markdown;
      if (state.currentPage === i) showPageMarkdown(i);
      updateOcrBadge(i);
      updateSaveBtn();
    } catch (err) {
      setStatus("OCR error: " + err.message, "error");
    }
    done++;
    showProgress(done, state.pageCount);
  }

  hideProgress();
  if (!state.stopRequested) setStatus("All pages processed.", "success");
  setProcessing(false);
}

function setBadgeProcessing(pageNum) {
  if (state.currentPage === pageNum) {
    dom.pageOcrBadge.style.display = "inline-flex";
    dom.pageOcrBadge.className = "page-badge processing";
    dom.pageOcrBadge.innerHTML = '<div class="spinner"></div> processing';
  }
}
function setBadgeProcessingFor(pageNum) {
  if (state.currentPage === pageNum) setBadgeProcessing(pageNum);
}

function setProcessing(on) {
  state.isProcessing = on;
  dom.ocrPageBtn.disabled = on;
  dom.ocrAllBtn.disabled = on;
  dom.stopBtn.disabled = !on;
  dom.openBtn.disabled = on;
  dom.prevBtn.disabled = on || state.currentPage === 0;
  dom.nextBtn.disabled = on || state.currentPage === state.pageCount - 1;
}

function updateSaveBtn() {
  const hasAny = state.ocrResults.some(r => r);
  dom.saveBtn.disabled = !hasAny;
  dom.copyBtn.disabled = !hasAny;
}

/* ── Save ────────────────────────────────────────────────── */
dom.saveBtn.addEventListener("click", openSavePopup);

function openSavePopup() {
  const stem = state.sourceName.replace(/\.[^.]+$/, "");
  dom.savePathInput.value = `~/${stem}.md`;
  dom.savePopup.classList.add("open");
  setTimeout(() => dom.savePathInput.focus(), 50);
}

dom.saveCancelBtn.addEventListener("click", () => dom.savePopup.classList.remove("open"));
dom.savePopup.addEventListener("click", e => { if (e.target === dom.savePopup) dom.savePopup.classList.remove("open"); });

dom.saveConfirmBtn.addEventListener("click", async () => {
  const outPath = dom.savePathInput.value.trim();
  if (!outPath) { setStatus("Please enter an output path.", "error"); return; }

  dom.savePopup.classList.remove("open");

  // Sync any pending raw edits
  if (state.activeTab === "raw") {
    state.ocrResults[state.currentPage] = dom.mdRaw.value;
  }

  const combined = buildCombined();
  setStatus("Saving…");

  try {
    const resp = await fetch(`/api/save/${state.sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output_path: outPath, markdown: combined }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || resp.statusText);
    }
    const data = await resp.json();
    setStatus(`Saved to ${data.saved_to}`, "success");
  } catch (err) {
    setStatus("Save error: " + err.message, "error");
  }
});

/* ── Copy all ────────────────────────────────────────────── */
dom.copyBtn.addEventListener("click", async () => {
  const md = buildCombined();
  try {
    await navigator.clipboard.writeText(md);
    setStatus("Copied to clipboard!", "success");
  } catch {
    setStatus("Clipboard access denied.", "error");
  }
});

function buildCombined() {
  const pages = state.ocrResults.filter(r => r);
  return pages.join("\n\n---\n\n");
}

/* ── Drag & drop ─────────────────────────────────────────── */
let dragCounter = 0;
document.addEventListener("dragenter", e => { e.preventDefault(); dragCounter++; dom.dropOverlay.classList.add("active"); });
document.addEventListener("dragleave", () => { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dom.dropOverlay.classList.remove("active"); } });
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => {
  e.preventDefault();
  dragCounter = 0;
  dom.dropOverlay.classList.remove("active");
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

/* ── Resizable divider ───────────────────────────────────── */
const divider = $("divider");
const leftPanel = $("left-panel");
let dragging = false, startX = 0, startLeft = 0;

divider.addEventListener("mousedown", e => {
  dragging = true;
  startX = e.clientX;
  startLeft = leftPanel.getBoundingClientRect().width;
  divider.classList.add("dragging");
  document.body.style.userSelect = "none";
  document.body.style.cursor = "col-resize";
});
document.addEventListener("mousemove", e => {
  if (!dragging) return;
  const dx = e.clientX - startX;
  const total = document.getElementById("layout").getBoundingClientRect().width - divider.offsetWidth;
  const newLeft = Math.max(200, Math.min(total - 200, startLeft + dx));
  leftPanel.style.flex = "none";
  leftPanel.style.width = newLeft + "px";
});
document.addEventListener("mouseup", () => {
  if (!dragging) return;
  dragging = false;
  divider.classList.remove("dragging");
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
});

/* ── Keyboard shortcuts ──────────────────────────────────── */
document.addEventListener("keydown", e => {
  if (e.target === dom.mdRaw || e.target === dom.savePathInput) return;
  if (e.key === "ArrowLeft") navigatePage(-1);
  if (e.key === "ArrowRight") navigatePage(1);
  if (e.key === "o" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); dom.fileInput.click(); }
  if (e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!dom.saveBtn.disabled) openSavePopup(); }
  if (e.key === "Escape") dom.savePopup.classList.remove("open");
});
