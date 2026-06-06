/**
 * visualizations.js — Canvas waveform, spectrogram, DTW path drawing
 */

// ---------------------------------------------------------------------------
// Waveform
// ---------------------------------------------------------------------------

/**
 * Draw a mono waveform on a canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {Float32Array} samples
 * @param {{ color?: string, bgColor?: string, label?: string }} opts
 */
export function drawWaveform(canvas, samples, opts = {}) {
  const {
    color = '#6366f1',
    bgColor = '#f9fafb',
    label = '',
  } = opts;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  if (!samples || samples.length === 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No audio', W / 2, H / 2);
    return;
  }

  // Down-sample for display
  const step = Math.ceil(samples.length / W);
  const mid = H / 2;

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  for (let x = 0; x < W; x++) {
    const start = x * step;
    let min = Infinity;
    let max = -Infinity;
    for (let i = start; i < Math.min(start + step, samples.length); i++) {
      if (samples[i] < min) min = samples[i];
      if (samples[i] > max) max = samples[i];
    }
    const yMax = mid - max * mid * 0.9;
    const yMin = mid - min * mid * 0.9;
    if (x === 0) {
      ctx.moveTo(x, yMax);
    }
    ctx.lineTo(x, yMax);
    ctx.lineTo(x, yMin);
  }
  ctx.stroke();

  // Center line
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(99,102,241,0.2)';
  ctx.lineWidth = 1;
  ctx.moveTo(0, mid);
  ctx.lineTo(W, mid);
  ctx.stroke();

  // Label
  if (label) {
    ctx.fillStyle = 'rgba(55,65,81,0.8)';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(label, 6, 16);
  }
}

/**
 * Draw two waveforms stacked (A above B) on one canvas.
 */
export function drawStackedWaveforms(canvas, samplesA, samplesB) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const half = H / 2;

  ctx.fillStyle = '#f9fafb';
  ctx.fillRect(0, 0, W, H);

  // Divider
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, half);
  ctx.lineTo(W, half);
  ctx.stroke();

  drawWaveformSection(ctx, samplesA, 0, half, W, '#6366f1', 'A');
  drawWaveformSection(ctx, samplesB, half, half, W, '#10b981', 'B');
}

function drawWaveformSection(ctx, samples, offsetY, height, W, color, label) {
  if (!samples || samples.length === 0) return;

  const step = Math.ceil(samples.length / W);
  const mid = offsetY + height / 2;

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  for (let x = 0; x < W; x++) {
    const start = x * step;
    let min = Infinity;
    let max = -Infinity;
    for (let i = start; i < Math.min(start + step, samples.length); i++) {
      if (samples[i] < min) min = samples[i];
      if (samples[i] > max) max = samples[i];
    }
    const amplitude = (height / 2) * 0.85;
    const yMax = mid - max * amplitude;
    const yMin = mid - min * amplitude;
    if (x === 0) ctx.moveTo(x, yMax);
    ctx.lineTo(x, yMax);
    ctx.lineTo(x, yMin);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(55,65,81,0.75)';
  ctx.font = 'bold 12px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(label, 6, offsetY + 16);
}

// ---------------------------------------------------------------------------
// Mel spectrogram
// ---------------------------------------------------------------------------

/**
 * Draw a mel spectrogram on canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Array<Float64Array>} spectrogram - frames × numFilters
 * @param {{ label?: string }} opts
 */
export function drawMelSpectrogram(canvas, spectrogram, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  if (!spectrogram || spectrogram.length === 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No spectrogram', W / 2, H / 2);
    return;
  }

  const numFrames = spectrogram.length;
  const numBins = spectrogram[0].length;

  // Find global min/max for color mapping
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const frame of spectrogram) {
    for (const v of frame) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }
  const range = maxVal - minVal || 1;

  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;

  for (let px = 0; px < W; px++) {
    const frameIdx = Math.min(Math.floor((px / W) * numFrames), numFrames - 1);
    const frame = spectrogram[frameIdx];

    for (let py = 0; py < H; py++) {
      // Flip Y axis (low freq at bottom)
      const binIdx = Math.min(Math.floor(((H - 1 - py) / H) * numBins), numBins - 1);
      const norm = (frame[binIdx] - minVal) / range;
      const [r, g, b] = viridis(norm);
      const idx = (py * W + px) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Label
  if (opts.label) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(opts.label, 6, 16);
  }
}

/**
 * Viridis-like color map: 0 = dark purple, 0.5 = teal, 1 = yellow.
 * @param {number} t - normalized value [0,1]
 * @returns {[number,number,number]} RGB
 */
function viridis(t) {
  // Simplified viridis approximation
  const r = Math.round(255 * Math.max(0, Math.min(1,
    t < 0.5
      ? 0.26 + t * 0.6
      : 0.56 + (t - 0.5) * 1.5
  )));
  const g = Math.round(255 * Math.max(0, Math.min(1,
    t < 0.25
      ? 0.0 + t * 1.2
      : t < 0.75
        ? 0.3 + (t - 0.25) * 1.2
        : 0.9 + (t - 0.75) * 0.4
  )));
  const b = Math.round(255 * Math.max(0, Math.min(1,
    t < 0.5
      ? 0.35 + t * 0.6
      : 0.65 - (t - 0.5) * 1.3
  )));
  return [r, g, b];
}

// ---------------------------------------------------------------------------
// DTW alignment path
// ---------------------------------------------------------------------------

/**
 * Draw the DTW cost matrix and alignment path on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Float64Array} matrix - flattened cost matrix (rows × cols)
 * @param {number} rows
 * @param {number} cols
 * @param {Array<[number,number]>} path - alignment path
 */
export function drawDTWPath(canvas, matrix, rows, cols, path) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  if (!matrix || matrix.length === 0 || rows === 0 || cols === 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No DTW data', W / 2, H / 2);
    return;
  }

  // Sub-sample the matrix to fit canvas
  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;

  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let k = 0; k < matrix.length; k++) {
    const v = matrix[k];
    if (isFinite(v)) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }
  const range = maxVal - minVal || 1;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const row = Math.min(Math.floor((py / H) * rows), rows - 1);
      const col = Math.min(Math.floor((px / W) * cols), cols - 1);
      const v = matrix[row * cols + col];
      const norm = isFinite(v) ? (v - minVal) / range : 1;
      const [r, g, b] = viridis(norm);
      const idx = (py * W + px) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Draw path
  if (path && path.length > 0) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(251,191,36,0.9)';
    ctx.lineWidth = 2;

    for (let k = 0; k < path.length; k++) {
      const [row, col] = path[k];
      const px = (col / cols) * W;
      const py = (row / rows) * H;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('Audio A →', 4, H - 4);
  ctx.save();
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Audio B →', -H + 4, 12);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Mini waveform (for slot preview)
// ---------------------------------------------------------------------------

/**
 * Draw a compact mini waveform preview.
 */
export function drawMiniWaveform(canvas, samples) {
  drawWaveform(canvas, samples, {
    color: '#6366f1',
    bgColor: '#eef2ff',
    label: '',
  });
}
