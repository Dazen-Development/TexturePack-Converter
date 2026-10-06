import { getConversionJob, saveConversionJob } from './preview-storage.js';

const params = new URLSearchParams(location.search);
const jobId = params.get('job');
const requestedEntryId = params.get('entry');

const refs = {
  loading: document.querySelector('#editor-loading'),
  missing: document.querySelector('#editor-missing'),
  content: document.querySelector('#editor-content'),
  title: document.querySelector('#editor-title'),
  reason: document.querySelector('#editor-reason'),
  sourceImage: document.querySelector('#editor-source-image'),
  sourcePath: document.querySelector('#editor-source-path'),
  targetPath: document.querySelector('#editor-target-path'),
  dimensions: document.querySelector('#editor-dimensions'),
  stage: document.querySelector('#editor-stage'),
  canvas: document.querySelector('#editor-canvas'),
  selection: document.querySelector('#selection-box'),
  handles: [...document.querySelectorAll('.editor-handle')],
  save: document.querySelector('#save-edit'),
  reset: document.querySelector('#reset-edit'),
  center: document.querySelector('#center-edit'),
  back: document.querySelector('#back-button'),
  lockAspect: document.querySelector('#lock-aspect'),
  x: document.querySelector('#edit-x'),
  y: document.querySelector('#edit-y'),
  width: document.querySelector('#edit-width'),
  height: document.querySelector('#edit-height'),
  saveStatus: document.querySelector('#editor-save-status'),
};

let job = null;
let entry = null;
let sourceBitmap = null;
let targetBitmap = null;
let sourceUrl = null;
let initialRect = null;
let rect = { x: 0, y: 0, w: 1, h: 1 };
let dragging = null;

init();

async function init() {
  if (!jobId || !requestedEntryId) return showMissing();

  try {
    job = await getConversionJob(jobId);
    if (!job) return showMissing();

    entry = (job.previewEntries || []).find(item => {
      const id = item.id || `${item.sourcePath}|${item.targetPath || ''}`;
      return id === requestedEntryId;
    });

    if (!entry?.editable || !entry.sourceBlob || !entry.targetPath) return showMissing();

    sourceBitmap = await decodeBlob(entry.sourceBlob);
    targetBitmap = entry.targetBlob ? await decodeBlob(entry.targetBlob) : sourceBitmap;
    sourceUrl = URL.createObjectURL(entry.sourceBlob);

    refs.sourceImage.src = sourceUrl;
    refs.title.textContent = entry.name || 'Texture';
    refs.reason.textContent = entry.reason || 'Adjust the converted image before downloading the final pack.';
    refs.sourcePath.textContent = entry.sourcePath || '';
    refs.targetPath.textContent = entry.targetPath || '';

    const targetWidth = Math.max(1, targetBitmap.width || sourceBitmap.width || 16);
    const targetHeight = Math.max(1, targetBitmap.height || sourceBitmap.height || 16);
    refs.canvas.width = targetWidth;
    refs.canvas.height = targetHeight;
    refs.stage.style.aspectRatio = `${targetWidth} / ${targetHeight}`;
    refs.dimensions.textContent = `${targetWidth} × ${targetHeight}px`;

    initialRect = entry.editorState
      ? normalizeRect(entry.editorState)
      : defaultRect(sourceBitmap.width, sourceBitmap.height, targetWidth, targetHeight);

    rect = { ...initialRect };
    bindInteractions();
    updateAll();

    refs.loading.hidden = true;
    refs.content.hidden = false;
  } catch (error) {
    console.error(error);
    showMissing();
  }
}

function showMissing() {
  refs.loading.hidden = true;
  refs.content.hidden = true;
  refs.missing.hidden = false;
}

function defaultRect(sourceW, sourceH, targetW, targetH) {
  // Keep one source pixel equal to one target pixel by default. This matches
  // real Bedrock glyph packs where a Java rank image (for example 64x18) is
  // placed unscaled inside a larger glyph slot (for example 128x128).
  if (sourceW <= targetW && sourceH <= targetH) {
    const w = sourceW / targetW;
    const h = sourceH / targetH;
    return {
      x: (1 - w) / 2,
      y: (1 - h) / 2,
      w,
      h,
    };
  }

  // Only scale down when the source physically cannot fit in the target.
  const scale = Math.min(targetW / sourceW, targetH / sourceH);
  const w = (sourceW * scale) / targetW;
  const h = (sourceH * scale) / targetH;

  return {
    x: (1 - w) / 2,
    y: (1 - h) / 2,
    w,
    h,
  };
}

function normalizeRect(value) {
  return {
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    w: Math.max(0.01, finite(value.w, 1)),
    h: Math.max(0.01, finite(value.h, 1)),
  };
}

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bindInteractions() {
  refs.selection.addEventListener('pointerdown', event => {
    if (event.target.closest('.editor-handle')) return;
    event.preventDefault();
    refs.selection.setPointerCapture?.(event.pointerId);
    dragging = {
      mode: 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect: { ...rect },
    };
  });

  for (const handle of refs.handles) {
    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture?.(event.pointerId);
      dragging = {
        mode: 'resize',
        corner: handle.dataset.corner,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startRect: { ...rect },
        aspect: rect.w / rect.h,
      };
    });
  }

  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerup', () => { dragging = null; });
  addEventListener('pointercancel', () => { dragging = null; });

  for (const input of [refs.x, refs.y, refs.width, refs.height]) {
    input.addEventListener('change', updateFromNumbers);
  }

  refs.reset.addEventListener('click', () => {
    rect = { ...initialRect };
    updateAll();
    showStatus('Reset to the original converted placement.', 'info');
  });

  refs.center.addEventListener('click', () => {
    rect.x = (1 - rect.w) / 2;
    rect.y = (1 - rect.h) / 2;
    updateAll();
  });

  refs.save.addEventListener('click', saveCorrection);
  refs.back.addEventListener('click', () => {
    location.href = `./preview.html?job=${encodeURIComponent(jobId)}`;
  });
}

function onPointerMove(event) {
  if (!dragging) return;

  const bounds = refs.stage.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;

  const dx = (event.clientX - dragging.startX) / bounds.width;
  const dy = (event.clientY - dragging.startY) / bounds.height;
  const start = dragging.startRect;

  if (dragging.mode === 'move') {
    rect.x = start.x + dx;
    rect.y = start.y + dy;
    updateAll();
    return;
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  const corner = dragging.corner;

  if (corner.includes('w')) left = start.x + dx;
  if (corner.includes('e')) right = start.x + start.w + dx;
  if (corner.includes('n')) top = start.y + dy;
  if (corner.includes('s')) bottom = start.y + start.h + dy;

  const minSize = 0.01;
  if (right - left < minSize) {
    if (corner.includes('w')) left = right - minSize;
    else right = left + minSize;
  }
  if (bottom - top < minSize) {
    if (corner.includes('n')) top = bottom - minSize;
    else bottom = top + minSize;
  }

  let next = { x: left, y: top, w: right - left, h: bottom - top };

  if (refs.lockAspect.checked) {
    next = lockAspect(next, start, corner, dragging.aspect);
  }

  rect = next;
  updateAll();
}

function lockAspect(next, start, corner, aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return next;

  let w = next.w;
  let h = next.h;
  if (Math.abs(w - start.w) >= Math.abs(h - start.h)) h = w / aspect;
  else w = h * aspect;

  let x = next.x;
  let y = next.y;
  if (corner.includes('w')) x = start.x + start.w - w;
  if (corner.includes('n')) y = start.y + start.h - h;

  return { x, y, w: Math.max(.01, w), h: Math.max(.01, h) };
}

function updateFromNumbers() {
  rect = normalizeRect({
    x: refs.x.value,
    y: refs.y.value,
    w: refs.width.value,
    h: refs.height.value,
  });
  updateAll();
}

function updateAll() {
  renderCanvas();
  updateSelection();
  updateNumbers();
}

function renderCanvas() {
  const ctx = refs.canvas.getContext('2d');
  ctx.clearRect(0, 0, refs.canvas.width, refs.canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sourceBitmap,
    rect.x * refs.canvas.width,
    rect.y * refs.canvas.height,
    rect.w * refs.canvas.width,
    rect.h * refs.canvas.height
  );
}

function updateSelection() {
  refs.selection.style.left = `${rect.x * 100}%`;
  refs.selection.style.top = `${rect.y * 100}%`;
  refs.selection.style.width = `${rect.w * 100}%`;
  refs.selection.style.height = `${rect.h * 100}%`;
}

function updateNumbers() {
  refs.x.value = round(rect.x);
  refs.y.value = round(rect.y);
  refs.width.value = round(rect.w);
  refs.height.value = round(rect.h);
}

function round(value) {
  return Number(value.toFixed(4));
}

async function saveCorrection() {
  refs.save.disabled = true;
  refs.save.querySelector('span:first-child').textContent = 'Saving…';
  showStatus('Rebuilding the converted pack with your correction…', 'info');

  try {
    const editedBlob = await canvasToBlob(refs.canvas);
    const zip = await window.JSZip.loadAsync(job.outputBlob);

    if (entry.editSpec?.type === 'atlas-cell') {
      await replaceAtlasCell(zip, entry.editSpec, editedBlob);
    } else {
      const targetPath = entry.editSpec?.targetPath || entry.targetPath;
      if (!targetPath) throw new Error('This row does not have a writable target path.');
      zip.file(targetPath, editedBlob);
    }

    const rebuilt = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      streamFiles: true,
    });

    job.outputBlob = rebuilt;
    entry.targetBlob = editedBlob;
    entry.edited = true;
    entry.editorState = { ...rect };
    entry.reason = entry.reason
      ? `${entry.reason} Manual placement/scale correction saved.`
      : 'Manual placement/scale correction saved.';

    await saveConversionJob(job);
    showStatus('Saved. The downloadable pack now contains this corrected texture.', 'success');

    setTimeout(() => {
      location.href = `./preview.html?job=${encodeURIComponent(jobId)}`;
    }, 500);
  } catch (error) {
    console.error(error);
    showStatus(error.message || String(error), 'error');
  } finally {
    refs.save.disabled = false;
    refs.save.querySelector('span:first-child').textContent = 'Save Correction';
  }
}

async function replaceAtlasCell(zip, spec, editedBlob) {
  const atlasFile = zip.file(spec.targetPath);
  if (!atlasFile) throw new Error(`Glyph atlas not found in output: ${spec.targetPath}`);

  const atlasBlob = await atlasFile.async('blob');
  const atlasBitmap = await decodeBlob(atlasBlob);
  const glyphBitmap = await decodeBlob(editedBlob);
  const c = document.createElement('canvas');
  c.width = atlasBitmap.width;
  c.height = atlasBitmap.height;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlasBitmap, 0, 0);

  const cellSize = Number(spec.cellSize || 32);
  const x = Number(spec.col || 0) * cellSize;
  const y = Number(spec.row || 0) * cellSize;
  ctx.clearRect(x, y, cellSize, cellSize);
  ctx.drawImage(glyphBitmap, x, y, cellSize, cellSize);

  zip.file(spec.targetPath, await canvasToBlob(c));
}

async function decodeBlob(blob) {
  if (globalThis.createImageBitmap) return createImageBitmap(blob);

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to decode image.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Unable to encode edited PNG.')),
      'image/png'
    );
  });
}

function showStatus(message, kind) {
  refs.saveStatus.hidden = false;
  refs.saveStatus.className = `editor-save-status ${kind}`;
  refs.saveStatus.textContent = message;
}

addEventListener('beforeunload', () => {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
});
