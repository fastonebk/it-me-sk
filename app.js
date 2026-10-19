/* App wiring: screens, single-photo editor, bulk workflow, background removal. */

const els = {
  modeButtons: document.querySelectorAll(".mode-btn"),
  dropzone: document.getElementById("dropzone"),
  dzTitle: document.getElementById("dz-title"),
  dzSub: document.getElementById("dz-sub"),
  fileInput: document.getElementById("file-input"),
  fileInputBulk: document.getElementById("file-input-bulk"),
  modelStatus: document.getElementById("model-status"),
  segStatus: document.getElementById("seg-status"),

  screenUpload: document.getElementById("screen-upload"),
  screenSingle: document.getElementById("screen-single"),
  screenBulk: document.getElementById("screen-bulk"),

  cropperContainer: document.getElementById("cropper-container"),
  previewWrap: document.getElementById("preview-canvas-wrap"),
  previewCaption: document.getElementById("preview-caption"),
  formatSelect: document.getElementById("format-select"),
  sharpenToggle: document.getElementById("sharpen-toggle"),
  filenameInput: document.getElementById("filename-input"),
  singleDownload: document.getElementById("single-download"),
  singleBack: document.getElementById("single-back"),

  bulkGrid: document.getElementById("bulk-grid"),
  bulkCount: document.getElementById("bulk-count"),
  bulkFormatSelect: document.getElementById("bulk-format-select"),
  bulkSharpenToggle: document.getElementById("bulk-sharpen-toggle"),
  bulkDownload: document.getElementById("bulk-download"),
  bulkBack: document.getElementById("bulk-back"),

  modalBackdrop: document.getElementById("modal-backdrop"),
  modalClose: document.getElementById("modal-close"),
  modalCropperContainer: document.getElementById("modal-cropper-container"),
  modalPreviewWrap: document.getElementById("modal-preview-canvas-wrap"),
  modalReset: document.getElementById("modal-reset"),
  modalDone: document.getElementById("modal-done"),
};

let currentMode = "single";
let single = null; // { file, img, naturalW, naturalH, cropper, box }
let bulkItems = []; // [{ id, file, img, naturalW, naturalH, box, tileEl }]
let modalTarget = null;
let modalCropper = null;
let modalBoxDraft = null;
let bulkIdCounter = 0;
let singlePreviewToken = 0; // guards against out-of-order async preview renders

/* ---------- Model loading ---------- */

const modelLoadPromise = loadFaceModels();
modelLoadPromise.then((ok) => {
  els.modelStatus.classList.remove("is-loading");
  if (ok) {
    els.modelStatus.textContent = "Face detection ready — crops auto-center on the eyes.";
    els.modelStatus.classList.add("is-ready");
  } else {
    els.modelStatus.textContent = "Face detection unavailable — frame photos manually with the crop box.";
    els.modelStatus.classList.add("is-error");
  }
});

const segLoadPromise = loadSegmentationModel();
segLoadPromise.then((ok) => {
  els.segStatus.classList.remove("is-loading");
  if (ok) {
    els.segStatus.textContent = "Background removal ready.";
    els.segStatus.classList.add("is-ready");
  } else {
    els.segStatus.textContent = "Background removal unavailable — photos will keep their original background.";
    els.segStatus.classList.add("is-error");
  }
});

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureModelsSettled() {
  await Promise.race([modelLoadPromise, timeout(6000)]);
}

async function ensureSegSettled() {
  await Promise.race([segLoadPromise, timeout(8000)]);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- Mode toggle ---------- */

els.modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    els.modeButtons.forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");
    currentMode = btn.dataset.mode;
    els.fileInput.multiple = currentMode === "bulk";
    if (currentMode === "bulk") {
      els.dzTitle.textContent = "Click to upload, or drag photos here";
      els.dzSub.textContent = "JPG or PNG — select multiple files at once";
    } else {
      els.dzTitle.textContent = "Click to upload, or drag a photo here";
      els.dzSub.textContent = "JPG or PNG";
    }
  });
});

/* ---------- Dropzone ---------- */

["dragover", "dragenter"].forEach((evt) => {
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("is-dragover");
  });
});
["dragleave", "dragend"].forEach((evt) => {
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("is-dragover");
  });
});
els.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dropzone.classList.remove("is-dragover");
  handleFiles(e.dataTransfer.files, currentMode);
});
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});

els.fileInput.addEventListener("change", () => {
  handleFiles(els.fileInput.files, currentMode);
  els.fileInput.value = "";
});
els.fileInputBulk.addEventListener("change", () => {
  handleFiles(els.fileInputBulk.files, "bulk");
  els.fileInputBulk.value = "";
});

function handleFiles(fileList, mode) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  if (mode === "single") {
    openSingle(files[0]);
  } else {
    openBulk(files);
  }
}

function showScreen(name) {
  els.screenUpload.hidden = name !== "upload";
  els.screenSingle.hidden = name !== "single";
  els.screenBulk.hidden = name !== "bulk";
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- Background pickers (single, bulk-global, per-photo) ---------- */

const singleBg = createBgPicker(document.getElementById("bg-picker"), {
  onChange: () => renderSinglePreview(),
});
const bulkBg = createBgPicker(document.getElementById("bulk-bg-picker"), {
  onChange: debounce(() => bulkItems.forEach((i) => { if (i.bg === "inherit") renderTile(i); }), 250),
});
const modalBg = createBgPicker(document.getElementById("modal-bg-picker"), {
  value: "inherit",
  allowInherit: true,
  onChange: () => renderModalPreview(),
});
// A photo's own background wins; "inherit" means use the bulk-wide setting.
function itemBg(item) {
  return item.bg === "inherit" ? bulkBg.getValue() : item.bg;
}

/* ================= SINGLE MODE ================= */

async function openSingle(file) {
  showScreen("single");
  els.previewWrap.innerHTML = "";
  els.cropperContainer.innerHTML = "<p style=\"color:#c9d0e0;padding:40px;font-size:0.85rem;\">Loading photo…</p>";

  const img = await loadImage(file);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;

  await ensureModelsSettled();
  const face = await detectFace(img);
  const box = autoCropBox(naturalW, naturalH, face);

  els.cropperContainer.innerHTML = "";
  const cropper = new Cropper(els.cropperContainer, img, naturalW, naturalH, ASPECT);
  cropper.setBoxNatural(box);
  cropper.onChange = debouncedSinglePreview;

  single = { file, img, naturalW, naturalH, cropper, box };

  const baseName = file.name.replace(/\.[^/.]+$/, "") || "id-photo";
  els.filenameInput.value = baseName;

  renderSinglePreview();
}

async function buildFinalCanvas(imgEl, box, { sharpen, bgMode }) {
  const canvas = cropAndResize(imgEl, box, TARGET_W, TARGET_H);
  if (sharpen) sharpenCanvas(canvas, 0.6);
  if (bgMode && bgMode !== "none") {
    await ensureSegSettled();
    await applyBackground(canvas, bgMode);
  }
  return canvas;
}

async function renderSinglePreview() {
  if (!single) return;
  const token = ++singlePreviewToken;
  const box = single.cropper.getBoxNatural();
  const bgMode = singleBg.getValue();
  const canvas = await buildFinalCanvas(single.img, box, {
    sharpen: els.sharpenToggle.checked,
    bgMode,
  });
  if (token !== singlePreviewToken) return; // a newer render started meanwhile
  els.previewWrap.innerHTML = "";
  els.previewWrap.appendChild(canvas);
}

const debouncedSinglePreview = debounce(renderSinglePreview, 300);

els.sharpenToggle.addEventListener("change", renderSinglePreview);

els.singleBack.addEventListener("click", () => {
  single = null;
  showScreen("upload");
});

els.singleDownload.addEventListener("click", async () => {
  if (!single) return;
  els.singleDownload.disabled = true;
  els.singleDownload.textContent = "Preparing…";
  try {
    const box = single.cropper.getBoxNatural();
    const bgMode = singleBg.getValue();
    const canvas = await buildFinalCanvas(single.img, box, {
      sharpen: els.sharpenToggle.checked,
      bgMode,
    });
    const mime = els.formatSelect.value;
    const blob = await canvasToBlobWithDpi(canvas, mime, DPI);
    const ext = mime === "image/png" ? "png" : "jpg";
    const name = (els.filenameInput.value.trim() || "id-photo") + "." + ext;
    downloadBlob(blob, name);
  } finally {
    els.singleDownload.disabled = false;
    els.singleDownload.textContent = "Download photo";
  }
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ================= BULK MODE ================= */

async function openBulk(files) {
  showScreen("bulk");
  await ensureModelsSettled();

  const entries = [];
  for (const file of files) {
    const id = "item-" + ++bulkIdCounter;
    const tileEl = document.createElement("div");
    tileEl.className = "bulk-tile";
    tileEl.innerHTML = `
      <canvas width="${TARGET_W}" height="${TARGET_H}"></canvas>
      <div class="bulk-tile-name"></div>
      <div class="bulk-tile-status">Queued…</div>
      <div class="bulk-tile-tag">Custom background</div>
      <button type="button" class="bulk-tile-remove">Remove</button>
    `;
    els.bulkGrid.appendChild(tileEl);
    tileEl.querySelector(".bulk-tile-name").textContent = file.name;

    const item = { id, file, img: null, naturalW: 0, naturalH: 0, box: null, bg: "inherit", tileEl };
    bulkItems.push(item);

    tileEl.querySelector(".bulk-tile-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      removeBulkItem(id);
    });
    tileEl.addEventListener("click", () => openFineTune(id));

    entries.push(item);
  }
  updateBulkCount();

  // Process concurrently (a handful at a time, not all at once) so the grid
  // fills in fast without loading every full-resolution photo into memory
  // simultaneously on big batches.
  let done = 0;
  const total = entries.length;
  updateBulkProgress(done, total);

  await asyncPool(4, entries, async (item) => {
    item.tileEl.querySelector(".bulk-tile-status").textContent = "Detecting…";
    try {
      const img = await loadImage(item.file);
      item.img = img;
      item.naturalW = img.naturalWidth;
      item.naturalH = img.naturalHeight;
      const face = await detectFace(img);
      item.box = autoCropBox(item.naturalW, item.naturalH, face);
      await renderTile(item);
      const statusEl = item.tileEl.querySelector(".bulk-tile-status");
      statusEl.textContent = face ? "Face detected" : "Manual crop";
    } catch (err) {
      item.tileEl.querySelector(".bulk-tile-status").textContent = "Couldn't read file";
    } finally {
      done++;
      updateBulkProgress(done, total);
    }
  });

  updateBulkCount();
}

/** Runs `worker` over `items` with at most `concurrency` in flight at once. */
async function asyncPool(concurrency, items, worker) {
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => worker(item));
    executing.add(p);
    const clear = () => executing.delete(p);
    p.then(clear, clear);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

function updateBulkProgress(done, total) {
  els.bulkCount.textContent = `Detecting faces… ${done}/${total}`;
}

async function renderTile(item) {
  if (!item.img || !item.box) return;
  const bgMode = itemBg(item);
  const canvas = await buildFinalCanvas(item.img, item.box, {
    sharpen: els.bulkSharpenToggle.checked,
    bgMode,
  });
  const displayCanvas = item.tileEl.querySelector("canvas");
  const dctx = displayCanvas.getContext("2d");
  dctx.clearRect(0, 0, TARGET_W, TARGET_H);
  dctx.drawImage(canvas, 0, 0);
}

els.bulkSharpenToggle.addEventListener("change", () => {
  bulkItems.forEach(renderTile);
});

function updateBulkCount() {
  els.bulkCount.textContent = bulkItems.length + (bulkItems.length === 1 ? " photo" : " photos");
}

function removeBulkItem(id) {
  const idx = bulkItems.findIndex((i) => i.id === id);
  if (idx === -1) return;
  bulkItems[idx].tileEl.remove();
  bulkItems.splice(idx, 1);
  updateBulkCount();
}

els.bulkBack.addEventListener("click", () => {
  bulkItems = [];
  els.bulkGrid.innerHTML = "";
  updateBulkCount();
  showScreen("upload");
});

els.bulkDownload.addEventListener("click", async () => {
  const ready = bulkItems.filter((i) => i.img && i.box);
  if (!ready.length) return;
  els.bulkDownload.disabled = true;
  try {
    const zip = new JSZip();
    const mime = els.bulkFormatSelect.value;
    const ext = mime === "image/png" ? "png" : "jpg";
    const usedNames = new Set();
    let n = 0;

    for (const item of ready) {
      n++;
      els.bulkDownload.textContent = `Processing ${n}/${ready.length}…`;
      const canvas = await buildFinalCanvas(item.img, item.box, {
        sharpen: els.bulkSharpenToggle.checked,
        bgMode: itemBg(item),
      });
      const blob = await canvasToBlobWithDpi(canvas, mime, DPI);
      let base = item.file.name.replace(/\.[^/.]+$/, "") || "photo";
      let name = base + "." + ext;
      let dupe = 1;
      while (usedNames.has(name)) {
        name = `${base}-${++dupe}.${ext}`;
      }
      usedNames.add(name);
      zip.file(name, blob);
    }

    els.bulkDownload.textContent = "Zipping…";
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "id-photos.zip");
  } finally {
    els.bulkDownload.disabled = false;
    els.bulkDownload.textContent = "Download all (.zip)";
  }
});

/* ---------- Fine-tune modal ---------- */

function openFineTune(id) {
  const item = bulkItems.find((i) => i.id === id);
  if (!item || !item.img || !item.box) return;
  modalTarget = item;
  modalBg.setValue(item.bg);

  els.modalBackdrop.hidden = false;
  els.modalCropperContainer.innerHTML = "";
  modalCropper = new Cropper(els.modalCropperContainer, item.img, item.naturalW, item.naturalH, ASPECT);
  modalCropper.setBoxNatural(item.box);
  modalBoxDraft = { ...item.box };
  modalCropper.onChange = debouncedModalPreview;
  renderModalPreview();
}

async function renderModalPreview() {
  if (!modalTarget || !modalBoxDraft) return;
  const picked = modalBg.getValue();
  const bgMode = picked === "inherit" ? bulkBg.getValue() : picked;
  const canvas = await buildFinalCanvas(modalTarget.img, modalBoxDraft, {
    sharpen: els.bulkSharpenToggle.checked,
    bgMode,
  });
  els.modalPreviewWrap.innerHTML = "";
  els.modalPreviewWrap.appendChild(canvas);
}

const debouncedModalPreview = debounce((box) => {
  modalBoxDraft = box;
  renderModalPreview();
}, 300);

els.modalReset.addEventListener("click", async () => {
  if (!modalTarget) return;
  await ensureModelsSettled();
  const face = await detectFace(modalTarget.img);
  const box = autoCropBox(modalTarget.naturalW, modalTarget.naturalH, face);
  modalCropper.setBoxNatural(box);
});

function closeModal() {
  els.modalBackdrop.hidden = true;
  els.modalCropperContainer.innerHTML = "";
  modalCropper = null;
  modalTarget = null;
  modalBoxDraft = null;
}

els.modalClose.addEventListener("click", closeModal);
els.modalBackdrop.addEventListener("click", (e) => {
  if (e.target === els.modalBackdrop) closeModal();
});

els.modalDone.addEventListener("click", () => {
  if (modalTarget && modalBoxDraft) {
    modalTarget.box = modalBoxDraft;
    modalTarget.bg = modalBg.getValue();
    modalTarget.tileEl.classList.toggle("has-custom-bg", modalTarget.bg !== "inherit");
    renderTile(modalTarget);
    const statusEl = modalTarget.tileEl.querySelector(".bulk-tile-status");
    statusEl.textContent = "Adjusted manually";
  }
  closeModal();
});
