/* Background removal using @mediapipe/selfie_segmentation, loaded via a
 * <script> tag in index.html. Fully local — no network call per image, the
 * model weights are fetched once up front the same way the face-detection
 * models are. */

let segReady = false;
let segFailed = false;
let segInstance = null;
let segQueue = Promise.resolve(); // the library isn't safe to call concurrently

async function loadSegmentationModel() {
  if (typeof SelfieSegmentation === "undefined") {
    segFailed = true;
    return false;
  }
  try {
    segInstance = new SelfieSegmentation({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/${file}`,
    });
    segInstance.setOptions({ modelSelection: 1 }); // 1 = general/landscape model
    // Prime it with a tiny throwaway canvas so the first real call isn't
    // slowed down by lazy initialization.
    const warm = document.createElement("canvas");
    warm.width = 32;
    warm.height = 32;
    await new Promise((resolve) => {
      let done = false;
      segInstance.onResults(() => {
        if (!done) { done = true; resolve(); }
      });
      segInstance.send({ image: warm }).catch(() => {
        if (!done) { done = true; resolve(); }
      });
      setTimeout(() => { if (!done) { done = true; resolve(); } }, 8000);
    });
    segReady = true;
    return true;
  } catch (err) {
    segFailed = true;
    return false;
  }
}

/** Runs segmentation on a canvas, returns a same-size mask source (drawable) or null. */
function getSegmentationMask(canvasEl) {
  if (!segReady || !segInstance) return Promise.resolve(null);
  const run = () =>
    new Promise((resolve) => {
      let settled = false;
      segInstance.onResults((results) => {
        if (settled) return;
        settled = true;
        resolve(results.segmentationMask || null);
      });
      segInstance.send({ image: canvasEl }).catch(() => {
        if (!settled) { settled = true; resolve(null); }
      });
      setTimeout(() => {
        if (!settled) { settled = true; resolve(null); }
      }, 10000);
    });
  const p = segQueue.then(run);
  segQueue = p.catch(() => {});
  return p;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Replaces the background of `canvas` in place.
 * mode: "none" (no-op), "transparent", or a "#rrggbb" color.
 * Returns the same canvas (mutated) for chaining.
 */
async function applyBackground(canvas, mode) {
  if (!mode || mode === "none") return canvas;

  const mask = await getSegmentationMask(canvas);
  if (!mask) return canvas; // segmentation unavailable — leave the photo as-is

  const w = canvas.width, h = canvas.height;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mctx = maskCanvas.getContext("2d");
  mctx.drawImage(mask, 0, 0, w, h);
  const maskData = mctx.getImageData(0, 0, w, h).data; // grayscale; red channel = foreground prob.

  const ctx = canvas.getContext("2d");
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  const transparent = mode === "transparent";
  let fill = null; // RGBA pixels of the replacement background (solid or gradient)
  if (!transparent) {
    const f = document.createElement("canvas");
    f.width = w; f.height = h;
    const fctx = f.getContext("2d");
    if (mode.startsWith("grad|")) {
      const [, deg, c1, c2] = mode.split("|");
      const a = (parseFloat(deg) * Math.PI) / 180;
      const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
      const dx = (Math.sin(a) * len) / 2, dy = (-Math.cos(a) * len) / 2;
      const g = fctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
      g.addColorStop(0, c1); g.addColorStop(1, c2);
      fctx.fillStyle = g;
    } else {
      fctx.fillStyle = mode;
    }
    fctx.fillRect(0, 0, w, h);
    fill = fctx.getImageData(0, 0, w, h).data;
  }

  for (let i = 0; i < d.length; i += 4) {
    let alpha = maskData[i] / 255; // 1 = foreground, 0 = background
    // Tighten the soft mask a little so edges look cleaner.
    alpha = alpha < 0.2 ? 0 : alpha > 0.8 ? 1 : (alpha - 0.2) / 0.6;
    if (transparent) {
      d[i + 3] = Math.round(d[i + 3] * alpha);
    } else {
      d[i] = Math.round(d[i] * alpha + fill[i] * (1 - alpha));
      d[i + 1] = Math.round(d[i + 1] * alpha + fill[i + 1] * (1 - alpha));
      d[i + 2] = Math.round(d[i + 2] * alpha + fill[i + 2] * (1 - alpha));
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}
