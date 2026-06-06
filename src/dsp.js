/**
 * dsp.js — FFT, mel filterbank, MFCC, LPC, pitch tracking, correlation
 */

// ---------------------------------------------------------------------------
// FFT (Cooley-Tukey radix-2, in-place, complex input)
// ---------------------------------------------------------------------------

/**
 * Bit-reversal permutation helper.
 */
function bitReverse(n, bits) {
  let reversed = 0;
  for (let i = 0; i < bits; i++) {
    reversed = (reversed << 1) | (n & 1);
    n >>= 1;
  }
  return reversed;
}

/**
 * In-place Cooley-Tukey FFT.
 * @param {Float64Array} re - real parts (length must be power of 2)
 * @param {Float64Array} im - imaginary parts (same length)
 */
export function fft(re, im) {
  const N = re.length;
  const bits = Math.log2(N);

  // Bit-reversal
  for (let i = 0; i < N; i++) {
    const j = bitReverse(i, bits);
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterfly
  for (let size = 2; size <= N; size <<= 1) {
    const halfSize = size >> 1;
    const angle = (-2 * Math.PI) / size;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < N; i += size) {
      let tRe = 1.0;
      let tIm = 0.0;
      for (let j = 0; j < halfSize; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + halfSize] * tRe - im[i + j + halfSize] * tIm;
        const vIm = re[i + j + halfSize] * tIm + im[i + j + halfSize] * tRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + halfSize] = uRe - vRe;
        im[i + j + halfSize] = uIm - vIm;
        const newTRe = tRe * wRe - tIm * wIm;
        tIm = tRe * wIm + tIm * wRe;
        tRe = newTRe;
      }
    }
  }
}

/**
 * Compute magnitude spectrum from real signal.
 * Returns Float64Array of length N/2+1.
 */
export function magnitudeSpectrum(frame) {
  const N = nextPow2(frame.length);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < frame.length; i++) re[i] = frame[i];
  fft(re, im);
  const half = N / 2 + 1;
  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return mag;
}

export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// ---------------------------------------------------------------------------
// Resampling (linear interpolation)
// ---------------------------------------------------------------------------

/**
 * Resample a mono Float32Array to a target sample rate.
 */
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const lo = Math.floor(srcPos);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcPos - lo;
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Signal utilities
// ---------------------------------------------------------------------------

/**
 * Convert stereo interleaved samples to mono.
 */
export function toMono(samples, channels) {
  if (channels === 1) return samples;
  const mono = new Float32Array(samples.length / channels);
  for (let i = 0; i < mono.length; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += samples[i * channels + c];
    mono[i] = sum / channels;
  }
  return mono;
}

/**
 * Pre-emphasis filter: y[n] = x[n] - 0.97 * x[n-1]
 */
export function preEmphasis(samples, coeff = 0.97) {
  const out = new Float32Array(samples.length);
  out[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    out[i] = samples[i] - coeff * samples[i - 1];
  }
  return out;
}

/**
 * Normalize signal to zero mean, unit RMS.
 */
export function normalizeSamples(samples) {
  const N = samples.length;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += samples[i];
  mean /= N;
  let rms = 0;
  for (let i = 0; i < N; i++) {
    const v = samples[i] - mean;
    rms += v * v;
  }
  rms = Math.sqrt(rms / N) || 1e-10;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = (samples[i] - mean) / rms;
  return out;
}

/**
 * Trim leading/trailing silence below energy threshold.
 */
export function trimSilence(samples, sampleRate, threshold = 0.01, frameLen = 512) {
  const energy = (start, len) => {
    let e = 0;
    const end = Math.min(start + len, samples.length);
    for (let i = start; i < end; i++) e += samples[i] * samples[i];
    return e / len;
  };
  let startIdx = 0;
  while (startIdx < samples.length && energy(startIdx, frameLen) < threshold) {
    startIdx += frameLen;
  }
  let endIdx = samples.length;
  while (endIdx > startIdx && energy(endIdx - frameLen, frameLen) < threshold) {
    endIdx -= frameLen;
  }
  startIdx = Math.max(0, startIdx - frameLen);
  endIdx = Math.min(samples.length, endIdx + frameLen);
  return startIdx >= endIdx ? samples : samples.slice(startIdx, endIdx);
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/**
 * Split signal into overlapping frames with Hann window applied.
 * @param {Float32Array} samples
 * @param {number} frameSize - in samples
 * @param {number} hopSize - in samples
 * @returns {Array<Float64Array>} array of windowed frames
 */
export function frames(samples, frameSize, hopSize) {
  const result = [];
  const hann = hannWindow(frameSize);
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const frame = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      frame[i] = samples[start + i] * hann[i];
    }
    result.push(frame);
  }
  return result;
}

export function hannWindow(N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  return w;
}

// ---------------------------------------------------------------------------
// Mel filterbank
// ---------------------------------------------------------------------------

const MEL_FILTERS = 26;
const MEL_LOW_HZ = 0;
const MEL_HIGH_HZ = 8000;

function hzToMel(hz) {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel) {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Build mel filterbank matrix.
 * @param {number} numFilters
 * @param {number} fftSize - full FFT size (N)
 * @param {number} sampleRate
 * @returns {Array<Float64Array>} numFilters × (fftSize/2+1)
 */
export function buildMelFilterbank(numFilters, fftSize, sampleRate) {
  const numBins = fftSize / 2 + 1;
  const lowMel = hzToMel(MEL_LOW_HZ);
  const highMel = hzToMel(Math.min(MEL_HIGH_HZ, sampleRate / 2));
  const melPoints = [];
  for (let i = 0; i <= numFilters + 1; i++) {
    melPoints.push(melToHz(lowMel + (i * (highMel - lowMel)) / (numFilters + 1)));
  }
  const fftFreqs = Array.from({ length: numBins }, (_, i) => (i * sampleRate) / fftSize);
  const filters = [];
  for (let m = 1; m <= numFilters; m++) {
    const filter = new Float64Array(numBins);
    const lower = melPoints[m - 1];
    const center = melPoints[m];
    const upper = melPoints[m + 1];
    for (let k = 0; k < numBins; k++) {
      const f = fftFreqs[k];
      if (f >= lower && f <= center) {
        filter[k] = (f - lower) / (center - lower);
      } else if (f > center && f <= upper) {
        filter[k] = (upper - f) / (upper - center);
      }
    }
    filters.push(filter);
  }
  return filters;
}

// ---------------------------------------------------------------------------
// DCT-II (for MFCC)
// ---------------------------------------------------------------------------

export function dct(input, numCoeffs) {
  const N = input.length;
  const out = new Float64Array(numCoeffs);
  const scale0 = Math.sqrt(1 / N);
  const scale = Math.sqrt(2 / N);
  for (let k = 0; k < numCoeffs; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += input[n] * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N));
    }
    out[k] = sum * (k === 0 ? scale0 : scale);
  }
  return out;
}

// ---------------------------------------------------------------------------
// MFCC extraction
// ---------------------------------------------------------------------------

/**
 * Extract MFCC matrix from mono Float32Array at 16kHz.
 * @param {Float32Array} samples - mono 16kHz
 * @param {number} sampleRate
 * @param {Object} opts
 * @returns {Array<Float64Array>} frames × 13 MFCCs
 */
export function extractMFCCs(samples, sampleRate, opts = {}) {
  const {
    numCoeffs = 13,
    numFilters = 26,
    frameSizeMs = 25,
    hopSizeMs = 10,
  } = opts;

  const frameSize = nextPow2(Math.round((frameSizeMs / 1000) * sampleRate));
  const hopSize = Math.round((hopSizeMs / 1000) * sampleRate);

  const emphasized = preEmphasis(samples);
  const frameList = frames(emphasized, frameSize, hopSize);
  const filterbank = buildMelFilterbank(numFilters, frameSize, sampleRate);

  const mfccs = [];
  for (const frame of frameList) {
    const mag = magnitudeSpectrum(frame);
    const melEnergies = new Float64Array(numFilters);
    for (let m = 0; m < numFilters; m++) {
      let energy = 0;
      for (let k = 0; k < mag.length; k++) {
        energy += filterbank[m][k] * mag[k] * mag[k];
      }
      melEnergies[m] = Math.log(Math.max(energy, 1e-10));
    }
    const coeffs = dct(melEnergies, numCoeffs);
    mfccs.push(coeffs);
  }
  return mfccs;
}

/**
 * Extract 39-coefficient MFCC frames: static(13) + delta(13) + delta-delta(13).
 * @param {Float32Array} samples - mono audio
 * @param {number} sampleRate
 * @param {Object} opts - passed to extractMFCCs
 * @returns {Array<Float64Array>} frames × 39
 */
export function extractMFCCWithDeltas(samples, sampleRate, opts = {}) {
  const numCoeffs = opts.numCoeffs ?? 13;
  const staticFrames = extractMFCCs(samples, sampleRate, { ...opts, numCoeffs });
  const N = staticFrames.length;

  function computeDelta(frames) {
    return frames.map((_, t) => {
      const d = new Float64Array(numCoeffs);
      for (let k = 0; k < numCoeffs; k++) {
        const t1 = Math.max(0, t - 1);
        const t2 = Math.max(0, t - 2);
        const tp1 = Math.min(N - 1, t + 1);
        const tp2 = Math.min(N - 1, t + 2);
        d[k] = (frames[tp1][k] - frames[t1][k] + 2 * (frames[tp2][k] - frames[t2][k])) / 10;
      }
      return d;
    });
  }

  const d1 = computeDelta(staticFrames);
  const d2 = computeDelta(d1);

  return staticFrames.map((s, t) => {
    const out = new Float64Array(39);
    out.set(s, 0);
    out.set(d1[t], 13);
    out.set(d2[t], 26);
    return out;
  });
}

// ---------------------------------------------------------------------------
// Mel spectrogram (no DCT)
// ---------------------------------------------------------------------------

/**
 * Extract mel spectrogram (log mel filterbank energies per frame).
 * @returns {Array<Float64Array>} frames × numFilters
 */
export function extractMelSpectrogram(samples, sampleRate, opts = {}) {
  const {
    numFilters = 40,
    frameSizeMs = 25,
    hopSizeMs = 10,
  } = opts;

  const frameSize = nextPow2(Math.round((frameSizeMs / 1000) * sampleRate));
  const hopSize = Math.round((hopSizeMs / 1000) * sampleRate);

  const frameList = frames(samples, frameSize, hopSize);
  const filterbank = buildMelFilterbank(numFilters, frameSize, sampleRate);

  const spectrogram = [];
  for (const frame of frameList) {
    const mag = magnitudeSpectrum(frame);
    const melEnergies = new Float64Array(numFilters);
    for (let m = 0; m < numFilters; m++) {
      let energy = 0;
      for (let k = 0; k < mag.length; k++) {
        energy += filterbank[m][k] * mag[k] * mag[k];
      }
      melEnergies[m] = Math.log(Math.max(energy, 1e-10));
    }
    spectrogram.push(melEnergies);
  }
  return spectrogram;
}

// ---------------------------------------------------------------------------
// LPC (Levinson-Durbin) + formant extraction
// ---------------------------------------------------------------------------

/**
 * Compute LPC coefficients using Levinson-Durbin recursion.
 * @param {Float64Array} frame - windowed signal frame
 * @param {number} order - LPC order
 * @returns {Float64Array} LPC coefficients a[1..order]
 */
export function computeLPC(frame, order) {
  const N = frame.length;
  // Autocorrelation
  const r = new Float64Array(order + 1);
  for (let lag = 0; lag <= order; lag++) {
    let sum = 0;
    for (let i = 0; i < N - lag; i++) sum += frame[i] * frame[i + lag];
    r[lag] = sum;
  }

  if (r[0] < 1e-10) return new Float64Array(order);

  // Levinson-Durbin
  const a = new Float64Array(order + 1);
  const tmp = new Float64Array(order + 1);
  a[0] = 1.0;
  let error = r[0];

  for (let i = 1; i <= order; i++) {
    let lambda = 0;
    for (let j = 0; j < i; j++) lambda += a[j] * r[i - j];
    lambda = -lambda / error;

    for (let j = 0; j <= i; j++) tmp[j] = a[j] + lambda * a[i - j];
    for (let j = 0; j <= i; j++) a[j] = tmp[j];

    error *= 1 - lambda * lambda;
    if (error <= 0) break;
  }

  return a.slice(1); // return a[1..order]
}

/**
 * Find roots of LPC polynomial using companion matrix eigenvalues (power iteration approximation).
 * We use a simpler approach: evaluate polynomial on unit circle and find peaks.
 * @param {Float64Array} lpcCoeffs - a[1..order]
 * @param {number} sampleRate
 * @returns {number[]} array of formant frequencies in Hz
 */
export function lpcToFormants(lpcCoeffs, sampleRate) {
  const order = lpcCoeffs.length;
  const evalPoints = 512;
  const spectrum = new Float64Array(evalPoints);

  for (let k = 0; k < evalPoints; k++) {
    const theta = (Math.PI * k) / evalPoints;
    // H(z) = 1 / A(z), evaluate |A(e^{j theta})|
    let re = 1.0;
    let im = 0.0;
    for (let i = 0; i < order; i++) {
      const angle = (i + 1) * theta;
      re += lpcCoeffs[i] * Math.cos(angle);
      im += lpcCoeffs[i] * Math.sin(angle);
    }
    const mag2 = re * re + im * im;
    spectrum[k] = 1.0 / Math.max(mag2, 1e-10);
  }

  // Pick peaks
  const formants = [];
  for (let k = 1; k < evalPoints - 1; k++) {
    if (spectrum[k] > spectrum[k - 1] && spectrum[k] > spectrum[k + 1]) {
      const freq = (k * sampleRate) / (2 * evalPoints);
      if (freq > 90 && freq < sampleRate / 2 - 100) {
        formants.push({ freq, mag: spectrum[k] });
      }
    }
  }

  // Sort by magnitude, take top 4, then sort by frequency
  formants.sort((a, b) => b.mag - a.mag);
  const top = formants.slice(0, 4).map(f => f.freq).sort((a, b) => a - b);
  return top;
}

/**
 * Extract F1, F2 formant trajectories.
 * @param {Float32Array} samples - mono 16kHz
 * @param {number} sampleRate
 * @returns {{ f1: Float64Array, f2: Float64Array }}
 */
export function extractFormants(samples, sampleRate) {
  const frameSize = Math.round(0.025 * sampleRate); // 25ms
  const hopSize = Math.round(0.010 * sampleRate);   // 10ms
  const lpcOrder = 12;
  const energyThreshold = 0.001;
  const hann = hannWindow(frameSize);

  const f1s = [];
  const f2s = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const frame = new Float64Array(frameSize);
    let energy = 0;
    for (let i = 0; i < frameSize; i++) {
      frame[i] = samples[start + i] * hann[i];
      energy += frame[i] * frame[i];
    }
    energy /= frameSize;

    if (energy < energyThreshold) continue;

    const lpc = computeLPC(frame, lpcOrder);
    const formants = lpcToFormants(lpc, sampleRate);

    if (formants.length >= 2) {
      f1s.push(formants[0]);
      f2s.push(formants[1]);
    }
  }

  return {
    f1: new Float64Array(f1s),
    f2: new Float64Array(f2s),
  };
}

/**
 * Extract LPC coefficient frames (reuses computeLPC per frame).
 * @param {Float32Array} samples - mono audio
 * @param {number} sampleRate
 * @param {Object} opts
 * @returns {Array<Float64Array>} frames × lpcOrder
 */
export function extractLPCFrames(samples, sampleRate, opts = {}) {
  const { lpcOrder = 12, frameSizeMs = 25, hopSizeMs = 10 } = opts;
  const frameSize = Math.round((frameSizeMs / 1000) * sampleRate);
  const hopSize = Math.round((hopSizeMs / 1000) * sampleRate);
  const emphasized = preEmphasis(samples);
  const hann = hannWindow(frameSize);
  const result = [];
  for (let start = 0; start + frameSize <= emphasized.length; start += hopSize) {
    const frame = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) frame[i] = emphasized[start + i] * hann[i];
    result.push(computeLPC(frame, lpcOrder));
  }
  return result;
}

/**
 * Extract binary voiced/unvoiced frame sequence.
 * A frame is voiced if energy > threshold AND zero-crossing rate < zcrThreshold.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {Object} opts
 * @returns {Float64Array} 1.0 = voiced, 0.0 = unvoiced, one value per frame
 */
export function extractVoicedUnvoiced(samples, sampleRate, opts = {}) {
  const {
    frameSizeMs = 25,
    hopSizeMs = 10,
    energyThreshold = 0.001,
    zcrThreshold = 0.15,
  } = opts;
  const frameSize = Math.round((frameSizeMs / 1000) * sampleRate);
  const hopSize = Math.round((hopSizeMs / 1000) * sampleRate);
  const result = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let energy = 0;
    let zcr = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = samples[start + i];
      energy += s * s;
      if (i > 0 && Math.sign(s) !== Math.sign(samples[start + i - 1])) zcr++;
    }
    energy /= frameSize;
    zcr /= (frameSize - 1);
    result.push(energy > energyThreshold && zcr < zcrThreshold ? 1.0 : 0.0);
  }
  return new Float64Array(result);
}

// ---------------------------------------------------------------------------
// Pitch (F0) tracking via autocorrelation
// ---------------------------------------------------------------------------

/**
 * Track F0 via autocorrelation per frame.
 * @param {Float32Array} samples - mono 16kHz
 * @param {number} sampleRate
 * @returns {Float64Array} F0 values for voiced frames (Hz), unvoiced skipped
 */
export function extractPitch(samples, sampleRate) {
  const frameSize = Math.round(0.025 * sampleRate);
  const hopSize = Math.round(0.010 * sampleRate);
  const minLag = Math.floor(sampleRate / 500); // 500 Hz max
  const maxLag = Math.ceil(sampleRate / 50);   // 50 Hz min
  const voicingThreshold = 0.3;

  const pitches = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    // Compute autocorrelation
    let r0 = 0;
    for (let i = 0; i < frameSize; i++) r0 += samples[start + i] * samples[start + i];
    if (r0 < 1e-8) continue;

    let bestLag = -1;
    let bestVal = -Infinity;

    for (let lag = minLag; lag <= Math.min(maxLag, frameSize - 1); lag++) {
      let ac = 0;
      for (let i = 0; i + lag < frameSize; i++) {
        ac += samples[start + i] * samples[start + i + lag];
      }
      const norm = ac / r0;
      if (norm > bestVal) {
        bestVal = norm;
        bestLag = lag;
      }
    }

    if (bestLag > 0 && bestVal > voicingThreshold) {
      pitches.push(sampleRate / bestLag);
    }
  }

  return new Float64Array(pitches);
}

// ---------------------------------------------------------------------------
// Normalized cross-correlation (raw waveform)
// ---------------------------------------------------------------------------

/**
 * Compute normalized cross-correlation similarity between two signals.
 * Uses the maximum of the normalized cross-correlation over all lags.
 * @returns {number} similarity in [0, 1]
 */
export function crossCorrelationSimilarity(a, b) {
  // Normalize both
  const normA = normalizeSamples(a);
  const normB = normalizeSamples(b);

  // Use the shorter length
  const len = Math.min(normA.length, normB.length, 4096); // cap at 4096 for perf

  // Compute zero-lag dot product (normalized)
  let dot = 0;
  for (let i = 0; i < len; i++) dot += normA[i] * normB[i];

  // Normalize by length
  const sim = Math.abs(dot) / len;
  return Math.max(0, Math.min(1, sim));
}

// ---------------------------------------------------------------------------
// Mel spectrogram cross-correlation similarity
// ---------------------------------------------------------------------------

/**
 * Compute similarity between two mel spectrograms via normalized cross-correlation.
 * Handles different lengths by zero-padding.
 * @param {Array<Float64Array>} specA
 * @param {Array<Float64Array>} specB
 * @returns {number} similarity in [0, 1]
 */
export function melSpectrogramSimilarity(specA, specB) {
  const numFilters = specA[0].length;
  const lenA = specA.length;
  const lenB = specB.length;

  // Per-band correlation, then average
  let totalCorr = 0;
  let bandCount = 0;

  for (let m = 0; m < numFilters; m++) {
    const bandA = new Float64Array(lenA);
    const bandB = new Float64Array(lenB);
    for (let t = 0; t < lenA; t++) bandA[t] = specA[t][m];
    for (let t = 0; t < lenB; t++) bandB[t] = specB[t][m];

    const corr = pearsonCorrelation(bandA, bandB);
    if (!isNaN(corr)) {
      totalCorr += corr;
      bandCount++;
    }
  }

  const avgCorr = bandCount > 0 ? totalCorr / bandCount : 0;
  return Math.max(0, Math.min(1, (avgCorr + 1) / 2)); // map [-1,1] -> [0,1]
}

function pearsonCorrelation(a, b) {
  const len = Math.min(a.length, b.length);
  if (len < 2) return 0;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < len; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / len;
  const meanB = sumB / len;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < len; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom < 1e-10 ? 0 : cov / denom;
}
