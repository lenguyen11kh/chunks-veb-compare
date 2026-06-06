# Sound Mirror Methods & Evaluation Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the method stack for sound mirror (phonetic content matching), add user verdict labeling after each analysis, surface a method performance panel in History, and integrate wav2vec via ONNX for cross-language phonetic embedding.

**Architecture:** Phase 1 adds pure-math DSP methods and audio playback with no new dependencies. Phase 2 adds a verdict workflow (inline 4-button strip + History performance panel) backed by a pure `methodEvaluator.js` module. Phase 3 integrates `@xenova/transformers` via CDN importmap for lazy wav2vec inference.

**Tech Stack:** Vanilla ES modules, IndexedDB (existing), vitest (new, for unit tests), @xenova/transformers via CDN (Phase 3 only)

---

## File Map

### Created
- `src/methodEvaluator.js` — pure Spearman correlation of method scores vs verdicts
- `src/wav2vecMethod.js` — lazy ONNX wav2vec loader + similarity runner
- `tests/methodEvaluator.test.js` — unit tests
- `tests/dsp.deltas.test.js` — unit tests for new DSP functions
- `package.json` — minimal vitest devDep for running tests

### Modified
- `src/dsp.js` — add `extractMFCCWithDeltas`, `extractLPCFrames`, `extractVoicedUnvoiced`, `extractSpectralFlux`
- `src/methods.js` — upgrade M1, add LPC/VUV/sflux runners, update METHOD_DEFS, make `runAnalysis` async
- `src/ui.js` — add `renderVerdictStrip`, `renderMethodPerformancePanel`
- `src/main.js` — wire playback, verdict strip, performance panel; update verdict values
- `index.html` — add importmap for `@xenova/transformers` (Phase 3)

---

## PHASE 1 — New DSP Methods + Audio Playback

### Task 1.1 — Test infrastructure

**Files:**
- Create: `package.json`
- Create: `tests/dsp.deltas.test.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "chunks-audio-analyzer",
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Install vitest**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 3: Create failing stub test to verify setup**

Create `tests/dsp.deltas.test.js`:
```js
import { describe, it, expect } from 'vitest';

describe('dsp placeholder', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run tests to verify setup**

Run: `npm test`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/dsp.deltas.test.js
git commit -m "chore: add vitest test infrastructure"
```

---

### Task 1.2 — `extractMFCCWithDeltas` (39-coeff MFCC)

**Files:**
- Modify: `src/dsp.js` (add export after `extractMFCCs`)
- Modify: `tests/dsp.deltas.test.js`

- [ ] **Step 1: Write the failing test**

Replace `tests/dsp.deltas.test.js` with:
```js
import { describe, it, expect } from 'vitest';
import { extractMFCCWithDeltas } from '../src/dsp.js';

function sineWave(freq, sampleRate, durationSec) {
  const n = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return samples;
}

describe('extractMFCCWithDeltas', () => {
  it('returns 39-column frames for a sine wave', () => {
    const samples = sineWave(440, 16000, 0.5);
    const frames = extractMFCCWithDeltas(samples, 16000);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].length).toBe(39);
  });

  it('delta and delta-delta values are non-zero for a non-constant signal', () => {
    const samples = sineWave(440, 16000, 0.5);
    const frames = extractMFCCWithDeltas(samples, 16000);
    const midFrame = frames[Math.floor(frames.length / 2)];
    const deltaCoeffs = Array.from(midFrame.slice(13, 26));
    const hasNonZero = deltaCoeffs.some(v => Math.abs(v) > 1e-8);
    expect(hasNonZero).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `extractMFCCWithDeltas is not exported`

- [ ] **Step 3: Implement `extractMFCCWithDeltas` in `src/dsp.js`**

Add after the `extractMFCCs` function:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add src/dsp.js tests/dsp.deltas.test.js
git commit -m "feat: add extractMFCCWithDeltas (39-coeff MFCC with delta and delta-delta)"
```

---

### Task 1.3 — `extractLPCFrames`

**Files:**
- Modify: `src/dsp.js` (add export after `extractFormants`)
- Modify: `tests/dsp.deltas.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/dsp.deltas.test.js`:
```js
import { extractLPCFrames } from '../src/dsp.js';

describe('extractLPCFrames', () => {
  it('returns frames each with lpcOrder coefficients', () => {
    const samples = sineWave(440, 16000, 0.5);
    const frames = extractLPCFrames(samples, 16000, { lpcOrder: 12 });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].length).toBe(12);
  });

  it('coefficients are non-zero for a voiced signal', () => {
    const samples = sineWave(220, 16000, 0.5);
    const frames = extractLPCFrames(samples, 16000);
    const midFrame = frames[Math.floor(frames.length / 2)];
    const hasNonZero = Array.from(midFrame).some(v => Math.abs(v) > 1e-8);
    expect(hasNonZero).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `extractLPCFrames is not exported`

- [ ] **Step 3: Implement `extractLPCFrames` in `src/dsp.js`**

Add after `extractFormants`:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add src/dsp.js tests/dsp.deltas.test.js
git commit -m "feat: add extractLPCFrames for vocal tract shape comparison"
```

---

### Task 1.4 — `extractVoicedUnvoiced`

**Files:**
- Modify: `src/dsp.js`
- Modify: `tests/dsp.deltas.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/dsp.deltas.test.js`:
```js
import { extractVoicedUnvoiced } from '../src/dsp.js';

describe('extractVoicedUnvoiced', () => {
  it('classifies a sine wave as voiced (all 1s)', () => {
    const samples = sineWave(220, 16000, 0.3);
    const vuv = extractVoicedUnvoiced(samples, 16000);
    expect(vuv.length).toBeGreaterThan(0);
    const allVoiced = Array.from(vuv).every(v => v === 1.0);
    expect(allVoiced).toBe(true);
  });

  it('classifies silence as unvoiced (all 0s)', () => {
    const samples = new Float32Array(16000); // pure silence
    const vuv = extractVoicedUnvoiced(samples, 16000);
    const allUnvoiced = Array.from(vuv).every(v => v === 0.0);
    expect(allUnvoiced).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `extractVoicedUnvoiced is not exported`

- [ ] **Step 3: Implement `extractVoicedUnvoiced` in `src/dsp.js`**

Add after `extractLPCFrames`:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add src/dsp.js tests/dsp.deltas.test.js
git commit -m "feat: add extractVoicedUnvoiced for syllable skeleton rhythm"
```

---

### Task 1.5 — `extractSpectralFlux`

**Files:**
- Modify: `src/dsp.js`
- Modify: `tests/dsp.deltas.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/dsp.deltas.test.js`:
```js
import { extractSpectralFlux } from '../src/dsp.js';

describe('extractSpectralFlux', () => {
  it('returns one value per frame for a sine wave', () => {
    const samples = sineWave(440, 16000, 0.5);
    const flux = extractSpectralFlux(samples, 16000);
    expect(flux.length).toBeGreaterThan(0);
  });

  it('first frame is always 0 (no previous frame)', () => {
    const samples = sineWave(440, 16000, 0.3);
    const flux = extractSpectralFlux(samples, 16000);
    expect(flux[0]).toBe(0);
  });

  it('silence produces near-zero flux', () => {
    const samples = new Float32Array(16000);
    const flux = extractSpectralFlux(samples, 16000);
    const maxFlux = Math.max(...flux);
    expect(maxFlux).toBeLessThan(1e-6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `extractSpectralFlux is not exported`

- [ ] **Step 3: Implement `extractSpectralFlux` in `src/dsp.js`**

Add after `extractVoicedUnvoiced`:
```js
/**
 * Extract spectral flux: L2 norm of frame-to-frame magnitude spectrum difference.
 * First frame is always 0.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {Object} opts
 * @returns {Float64Array} one flux value per frame
 */
export function extractSpectralFlux(samples, sampleRate, opts = {}) {
  const { frameSizeMs = 25, hopSizeMs = 10 } = opts;
  const frameSize = nextPow2(Math.round((frameSizeMs / 1000) * sampleRate));
  const hopSize = Math.round((hopSizeMs / 1000) * sampleRate);
  const frameList = frames(samples, frameSize, hopSize);
  const fluxes = [0];
  for (let t = 1; t < frameList.length; t++) {
    const magCurr = magnitudeSpectrum(frameList[t]);
    const magPrev = magnitudeSpectrum(frameList[t - 1]);
    let flux = 0;
    for (let k = 0; k < magCurr.length; k++) {
      const diff = magCurr[k] - magPrev[k];
      flux += diff * diff;
    }
    fluxes.push(Math.sqrt(flux));
  }
  return new Float64Array(fluxes);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: `9 passed`

- [ ] **Step 5: Commit**

```bash
git add src/dsp.js tests/dsp.deltas.test.js
git commit -m "feat: add extractSpectralFlux for phoneme boundary rhythm"
```

---

### Task 1.6 — New method runners + upgrade M1

**Files:**
- Modify: `src/methods.js`

- [ ] **Step 1: Update imports in `src/methods.js`**

Replace the existing import block at the top of `src/methods.js`:
```js
import {
  extractMFCCWithDeltas,
  extractMelSpectrogram,
  extractFormants,
  extractPitch,
  extractLPCFrames,
  extractVoicedUnvoiced,
  extractSpectralFlux,
  crossCorrelationSimilarity,
  melSpectrogramSimilarity,
} from './dsp.js';
import { dtw, dtwScalar, dtw2D, distanceToSimilarity } from './dtw.js';
```

- [ ] **Step 2: Replace `runMFCCDTW` with the 39-coeff version**

Replace the entire `runMFCCDTW` function:
```js
export function runMFCCDTW(samplesA, samplesB, opts = {}) {
  const mfccA = extractMFCCWithDeltas(samplesA, 16000, opts);
  const mfccB = extractMFCCWithDeltas(samplesB, 16000, opts);
  const result = dtw(mfccA, mfccB);
  const score = Math.round(distanceToSimilarity(result.distance, 3.0));
  return {
    score,
    label: simLabel(score),
    data: {
      dtwDist: result.distance,
      mfccA,
      mfccB,
      path: result.path,
      matrix: result.matrix,
      rows: result.rows,
      cols: result.cols,
    },
  };
}
```

Note: scale bumped to 3.0 (from 2.0) because 39-coeff vectors have higher Euclidean magnitude.

- [ ] **Step 3: Add `runLPCSimilarity` after `runFormantSimilarity`**

```js
export function runLPCSimilarity(samplesA, samplesB) {
  const lpcA = extractLPCFrames(samplesA, 16000);
  const lpcB = extractLPCFrames(samplesB, 16000);
  if (!lpcA.length || !lpcB.length) {
    return { score: 0, label: 'Insufficient frames', data: {} };
  }
  const result = dtw(lpcA, lpcB);
  const score = Math.round(distanceToSimilarity(result.distance, 1.5));
  return { score, label: simLabel(score), data: { dtwDist: result.distance } };
}
```

- [ ] **Step 4: Add `runVUVRhythm` after `runLPCSimilarity`**

```js
export function runVUVRhythm(samplesA, samplesB) {
  const vuvA = extractVoicedUnvoiced(samplesA, 16000);
  const vuvB = extractVoicedUnvoiced(samplesB, 16000);
  if (vuvA.length < 2 || vuvB.length < 2) {
    return { score: 0, label: 'Insufficient frames', data: {} };
  }
  const wrappedA = Array.from(vuvA, v => new Float64Array([v]));
  const wrappedB = Array.from(vuvB, v => new Float64Array([v]));
  const result = dtw(wrappedA, wrappedB);
  const score = Math.round(distanceToSimilarity(result.distance, 0.3));
  return {
    score,
    label: simLabel(score),
    data: { dtwDist: result.distance, vuvA, vuvB },
  };
}
```

- [ ] **Step 5: Add `runSpectralFluxSimilarity` after `runVUVRhythm`**

```js
export function runSpectralFluxSimilarity(samplesA, samplesB) {
  const fluxA = extractSpectralFlux(samplesA, 16000);
  const fluxB = extractSpectralFlux(samplesB, 16000);
  if (fluxA.length < 2 || fluxB.length < 2) {
    return { score: 0, label: 'Insufficient frames', data: {} };
  }
  const result = dtwScalar(fluxA, fluxB);
  const score = Math.round(distanceToSimilarity(result.distance, 50));
  return { score, label: simLabel(score), data: { dtwDist: result.distance } };
}
```

- [ ] **Step 6: Update METHOD_DEFS**

Replace the entire `METHOD_DEFS` array:
```js
export const METHOD_DEFS = [
  {
    id: 'mfcc',
    name: 'MFCC-39 + DTW',
    subtitle: 'Timbre & spectral shape with velocity, time-aligned',
    defaultOn: true,
    run: (a, b, opts) => runMFCCDTW(a, b, opts?.mfcc),
  },
  {
    id: 'lpc',
    name: 'LPC + DTW',
    subtitle: 'Full vocal tract model — vowels and consonants',
    defaultOn: true,
    run: (a, b) => runLPCSimilarity(a, b),
  },
  {
    id: 'vuv',
    name: 'V/UV Rhythm',
    subtitle: 'Voiced/unvoiced syllable skeleton pattern',
    defaultOn: true,
    run: (a, b) => runVUVRhythm(a, b),
  },
  {
    id: 'sflux',
    name: 'Spectral Flux',
    subtitle: 'Phoneme boundary transition rhythm',
    defaultOn: false,
    run: (a, b) => runSpectralFluxSimilarity(a, b),
  },
  {
    id: 'formant',
    name: 'Formant Similarity',
    subtitle: 'Vowel quality via F1/F2 formant trajectories',
    defaultOn: false,
    run: (a, b) => runFormantSimilarity(a, b),
  },
  {
    id: 'melspec',
    name: 'Mel-Spectrogram Correlation',
    subtitle: 'Per-band energy pattern correlation',
    defaultOn: false,
    run: (a, b) => runMelSpectrogramSimilarity(a, b),
  },
  {
    id: 'pitch',
    name: 'Pitch (F0) Contour',
    subtitle: 'Prosody / intonation — not a sound mirror method',
    defaultOn: false,
    run: (a, b) => runPitchSimilarity(a, b),
  },
  {
    id: 'rawcorr',
    name: 'Raw Cross-Correlation',
    subtitle: 'Waveform identity only — not a sound mirror method',
    defaultOn: false,
    run: (a, b) => runRawCorrelation(a, b),
  },
];
```

- [ ] **Step 7: Make `runAnalysis` async**

Replace the `runAnalysis` function:
```js
export async function runAnalysis(samplesA, samplesB, enabledIds, opts = {}) {
  const results = new Map();
  for (const def of METHOD_DEFS) {
    if (!enabledIds.has(def.id)) continue;
    try {
      const result = await def.run(samplesA, samplesB, opts);
      results.set(def.id, { ...result, name: def.name, id: def.id });
    } catch (err) {
      results.set(def.id, {
        score: 0,
        label: 'Error: ' + err.message,
        data: {},
        name: def.name,
        id: def.id,
      });
    }
  }
  return results;
}
```

- [ ] **Step 8: Update `runComparison` in `src/main.js` to await runAnalysis**

In `src/main.js`, find the line:
```js
const results = runAnalysis(procA.samples, procB.samples, state.enabledMethods, {});
```
Replace with:
```js
const results = await runAnalysis(procA.samples, procB.samples, state.enabledMethods, {});
```

- [ ] **Step 9: Open the app in a browser and run a comparison with the new methods enabled. Verify score cards appear for `lpc`, `vuv`, and `sflux`.**

Run: `python -m http.server 8000 --bind 127.0.0.1` and open http://127.0.0.1:8000/

- [ ] **Step 10: Commit**

```bash
git add src/methods.js src/main.js
git commit -m "feat: add LPC, VUV rhythm, spectral flux methods; upgrade MFCC to 39-coeff"
```

---

### Task 1.7 — Audio playback on main analysis page

**Files:**
- Modify: `src/ui.js`
- Modify: `src/main.js`

- [ ] **Step 1: Add `setSlotPlayback` to `src/ui.js`**

Append to `src/ui.js`:
```js
/**
 * Show or hide an audio playback element inside a slot panel.
 * @param {HTMLElement} slotEl
 * @param {string|null} audioUrl - object URL or null to remove
 */
export function setSlotPlayback(slotEl, audioUrl) {
  let player = slotEl.querySelector('.slot-audio-player');
  if (!audioUrl) {
    player?.remove();
    return;
  }
  if (!player) {
    player = document.createElement('audio');
    player.className = 'slot-audio-player';
    player.controls = true;
    player.preload = 'metadata';
    slotEl.appendChild(player);
  }
  player.src = audioUrl;
}
```

- [ ] **Step 2: Import `setSlotPlayback` in `src/main.js`**

In the import block at the top of `src/main.js`, add `setSlotPlayback` to the import from `./ui.js`:
```js
import {
  renderMethodCards,
  createScoreCard,
  createComparisonTable,
  renderRadarChart,
  setSlotLoading,
  setSlotInfo,
  setSlotHasAudio,
  setSlotPlayback,
  showToast,
  exportResultsToJSON,
} from './ui.js';
```

- [ ] **Step 3: Add slot playback URLs to app state**

In `src/main.js`, add `slotObjectUrls` to the state object:
```js
const state = {
  audioA: null,
  audioB: null,
  processedA: null,
  processedB: null,
  enabledMethods: new Set(METHOD_DEFS.filter(m => m.defaultOn).map(m => m.id)),
  preprocessing: { normalize: false, trimSilence: false },
  analysisGoal: 'sound-mirror',
  lastResults: null,
  lastHistoryId: null,
  selectedHistoryId: null,
  historyObjectUrls: [],
  slotObjectUrls: { a: null, b: null },
  recorders: { a: new AudioRecorder(), b: new AudioRecorder() },
};
```

Note: also updated `analysisGoal` default to `'sound-mirror'` per ADR-0001.

- [ ] **Step 4: Add `setSlotPlaybackUrl` helper in `src/main.js`**

Add this function after `clearCanvas`:
```js
function setSlotPlaybackUrl(slot, blob) {
  const key = slot.toLowerCase();
  if (state.slotObjectUrls[key]) URL.revokeObjectURL(state.slotObjectUrls[key]);
  const url = blob ? URL.createObjectURL(blob) : null;
  state.slotObjectUrls[key] = url;
  setSlotPlayback($(`slot-${key}`), url);
}
```

- [ ] **Step 5: Call `setSlotPlaybackUrl` after audio loads in `setupSlot`**

In `setupSlot`, after `drawMiniWaveform(waveCanvas, audio.samples);` in the upload handler, add:
```js
setSlotPlaybackUrl(slot, audio.blob);
```
And in the recorder stop handler, after `drawMiniWaveform(waveCanvas, audio.samples);`, add:
```js
setSlotPlaybackUrl(slot, audio.blob);
```

- [ ] **Step 6: Clear playback URLs in `resetAudioSlots`**

In `resetAudioSlots`, add at the end of the `for` loop body (after `clearCanvas(waveCanvas)`):
```js
setSlotPlaybackUrl(slot, null);
```

- [ ] **Step 7: Open the app, record or upload audio, verify `<audio>` player appears in the slot and plays back correctly.**

- [ ] **Step 8: Commit**

```bash
git add src/ui.js src/main.js
git commit -m "feat: add audio playback in slot panels after upload or recording"
```

---

## PHASE 2 — Verdict UI + Method Performance Panel

### Task 2.1 — `methodEvaluator.js` (pure module)

**Files:**
- Create: `src/methodEvaluator.js`
- Create: `tests/methodEvaluator.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/methodEvaluator.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { verdictToRank, computeMethodPerformance } from '../src/methodEvaluator.js';

describe('verdictToRank', () => {
  it('maps all four verdict values to ranks 1-4', () => {
    expect(verdictToRank('very-similar')).toBe(4);
    expect(verdictToRank('similar')).toBe(3);
    expect(verdictToRank('different')).toBe(2);
    expect(verdictToRank('very-different')).toBe(1);
  });

  it('maps unreviewed to null', () => {
    expect(verdictToRank('unreviewed')).toBe(null);
  });

  it('maps unknown values to null', () => {
    expect(verdictToRank('anything-else')).toBe(null);
  });
});

function makeEntry(methodId, score, verdict) {
  return {
    summary: { methods: [{ id: methodId, score }] },
    review: { humanVerdict: verdict },
  };
}

describe('computeMethodPerformance', () => {
  it('returns empty array when fewer than 5 labeled entries', () => {
    const entries = [
      makeEntry('mfcc', 90, 'very-similar'),
      makeEntry('mfcc', 80, 'similar'),
    ];
    expect(computeMethodPerformance(entries)).toEqual([]);
  });

  it('returns empty array when all entries are unreviewed', () => {
    const entries = Array.from({ length: 10 }, () => makeEntry('mfcc', 70, 'unreviewed'));
    expect(computeMethodPerformance(entries)).toEqual([]);
  });

  it('returns correlation of 1.0 for perfectly rank-ordered scores', () => {
    const entries = [
      makeEntry('mfcc', 100, 'very-similar'),
      makeEntry('mfcc', 75, 'similar'),
      makeEntry('mfcc', 50, 'different'),
      makeEntry('mfcc', 25, 'very-different'),
      makeEntry('mfcc', 10, 'very-different'),
    ];
    const results = computeMethodPerformance(entries);
    expect(results.length).toBe(1);
    expect(results[0].methodId).toBe('mfcc');
    expect(results[0].correlation).toBeCloseTo(1.0, 2);
    expect(results[0].sampleSize).toBe(5);
  });

  it('returns correlation near -1.0 for inverted scores', () => {
    const entries = [
      makeEntry('mfcc', 10, 'very-similar'),
      makeEntry('mfcc', 25, 'similar'),
      makeEntry('mfcc', 75, 'different'),
      makeEntry('mfcc', 90, 'very-different'),
      makeEntry('mfcc', 100, 'very-different'),
    ];
    const results = computeMethodPerformance(entries);
    expect(results[0].correlation).toBeLessThan(-0.8);
  });

  it('excludes unreviewed entries from correlation', () => {
    const entries = [
      makeEntry('mfcc', 100, 'very-similar'),
      makeEntry('mfcc', 75, 'similar'),
      makeEntry('mfcc', 50, 'different'),
      makeEntry('mfcc', 25, 'very-different'),
      makeEntry('mfcc', 10, 'very-different'),
      makeEntry('mfcc', 99, 'unreviewed'), // should be ignored
    ];
    const results = computeMethodPerformance(entries);
    expect(results[0].sampleSize).toBe(5); // not 6
  });

  it('sorts results by correlation descending', () => {
    const entries = [
      { summary: { methods: [{ id: 'good', score: 100 }, { id: 'bad', score: 10 }] }, review: { humanVerdict: 'very-similar' } },
      { summary: { methods: [{ id: 'good', score: 75 }, { id: 'bad', score: 90 }] }, review: { humanVerdict: 'similar' } },
      { summary: { methods: [{ id: 'good', score: 50 }, { id: 'bad', score: 60 }] }, review: { humanVerdict: 'different' } },
      { summary: { methods: [{ id: 'good', score: 25 }, { id: 'bad', score: 80 }] }, review: { humanVerdict: 'very-different' } },
      { summary: { methods: [{ id: 'good', score: 10 }, { id: 'bad', score: 95 }] }, review: { humanVerdict: 'very-different' } },
    ];
    const results = computeMethodPerformance(entries);
    expect(results[0].methodId).toBe('good');
    expect(results[1].methodId).toBe('bad');
    expect(results[0].correlation).toBeGreaterThan(results[1].correlation);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/methodEvaluator.js'`

- [ ] **Step 3: Implement `src/methodEvaluator.js`**

Create `src/methodEvaluator.js`:
```js
/**
 * methodEvaluator.js — Pure Spearman rank correlation of method scores vs user verdicts.
 * No DOM, no side effects. Fully testable in isolation.
 */

const VERDICT_RANKS = {
  'very-similar': 4,
  'similar': 3,
  'different': 2,
  'very-different': 1,
};

export function verdictToRank(verdict) {
  return VERDICT_RANKS[verdict] ?? null;
}

/**
 * Compute per-method Spearman correlation against user verdicts.
 * @param {Array} entries - HistoryEntry objects with summary.methods and review.humanVerdict
 * @returns {Array<{methodId: string, correlation: number, sampleSize: number}>} sorted desc by correlation
 */
export function computeMethodPerformance(entries) {
  const labeled = entries.filter(e => verdictToRank(e.review?.humanVerdict) !== null);
  if (labeled.length < 5) return [];

  const methodIds = new Set();
  for (const e of labeled) {
    for (const m of e.summary?.methods ?? []) methodIds.add(m.id);
  }

  const results = [];
  for (const methodId of methodIds) {
    const pairs = labeled
      .map(e => {
        const method = e.summary?.methods?.find(m => m.id === methodId);
        const rank = verdictToRank(e.review.humanVerdict);
        return method != null && rank != null ? [method.score, rank] : null;
      })
      .filter(Boolean);

    if (pairs.length < 5) continue;

    const scores = pairs.map(([s]) => s);
    const ranks = pairs.map(([, r]) => r);
    results.push({ methodId, correlation: spearman(scores, ranks), sampleSize: pairs.length });
  }

  return results.sort((a, b) => b.correlation - a.correlation);
}

function rankArray(arr) {
  const indexed = arr.map((v, i) => [v, i]).sort(([a], [b]) => a - b);
  const ranks = new Array(arr.length);
  for (let i = 0; i < indexed.length; i++) ranks[indexed[i][1]] = i + 1;
  return ranks;
}

function spearman(a, b) {
  const ra = rankArray(a);
  const rb = rankArray(b);
  const n = ra.length;
  let dSum = 0;
  for (let i = 0; i < n; i++) {
    const d = ra[i] - rb[i];
    dSum += d * d;
  }
  return 1 - (6 * dSum) / (n * (n * n - 1));
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all 12+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/methodEvaluator.js tests/methodEvaluator.test.js
git commit -m "feat: add methodEvaluator with Spearman rank correlation"
```

---

### Task 2.2 — Update humanVerdict to 4-point scale

**Files:**
- Modify: `src/main.js`

The existing verdict dropdown in `renderHistoryDetail` uses values `'similar'`, `'different'`, `'inconclusive'`, `'bad-data'`. Update to the 4-point sound mirror scale.

- [ ] **Step 1: Update the `humanVerdict` select options in `renderHistoryDetail`**

Find this block in `renderHistoryDetail`:
```js
${renderSelectOption('unreviewed', 'Unreviewed', review.humanVerdict)}
${renderSelectOption('similar', 'Human: Similar', review.humanVerdict)}
${renderSelectOption('different', 'Human: Different', review.humanVerdict)}
${renderSelectOption('inconclusive', 'Human: Inconclusive', review.humanVerdict)}
${renderSelectOption('bad-data', 'Bad data / cannot judge', review.humanVerdict)}
```

Replace with:
```js
${renderSelectOption('unreviewed', 'Unreviewed', review.humanVerdict)}
${renderSelectOption('very-similar', 'Very Similar', review.humanVerdict)}
${renderSelectOption('similar', 'Similar', review.humanVerdict)}
${renderSelectOption('different', 'Different', review.humanVerdict)}
${renderSelectOption('very-different', 'Very Different', review.humanVerdict)}
```

- [ ] **Step 2: Commit**

```bash
git add src/main.js
git commit -m "feat: update humanVerdict to 4-point scale (very-similar/similar/different/very-different)"
```

---

### Task 2.3 — Inline verdict strip after analysis

**Files:**
- Modify: `src/ui.js`
- Modify: `src/main.js`

- [ ] **Step 1: Add `renderVerdictStrip` to `src/ui.js`**

Append to `src/ui.js`:
```js
const VERDICT_OPTIONS = [
  { value: 'very-similar', label: 'Very Similar' },
  { value: 'similar', label: 'Similar' },
  { value: 'different', label: 'Different' },
  { value: 'very-different', label: 'Very Different' },
];

/**
 * Render a 4-button verdict strip for inline labeling after analysis.
 * @param {string|null} currentVerdict - the currently selected verdict value
 * @param {function(string): void} onChange - called with new verdict value on click
 * @returns {HTMLElement}
 */
export function renderVerdictStrip(currentVerdict, onChange) {
  const strip = document.createElement('div');
  strip.className = 'verdict-strip';

  const label = document.createElement('div');
  label.className = 'verdict-strip-label';
  label.textContent = 'YOUR VERDICT';
  strip.appendChild(label);

  const buttons = document.createElement('div');
  buttons.className = 'verdict-strip-buttons';

  for (const opt of VERDICT_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'verdict-btn' + (opt.value === currentVerdict ? ' verdict-btn--active' : '');
    btn.textContent = opt.label;
    btn.dataset.verdict = opt.value;
    btn.addEventListener('click', () => {
      strip.querySelectorAll('.verdict-btn').forEach(b => b.classList.remove('verdict-btn--active'));
      btn.classList.add('verdict-btn--active');
      onChange(opt.value);
    });
    buttons.appendChild(btn);
  }
  strip.appendChild(buttons);
  return strip;
}
```

- [ ] **Step 2: Import `renderVerdictStrip` and `updateAnalysisReview` in `src/main.js`**

Add `renderVerdictStrip` to the import from `./ui.js`.
The `updateAnalysisReview` import already exists from `./historyStore.js?v=2`.

- [ ] **Step 3: Add verdict strip rendering after results in `renderResults`**

In `src/main.js`, at the end of the `renderResults` function, add:
```js
  // Verdict strip
  const verdictContainer = $('verdict-strip-container');
  if (verdictContainer) {
    const current = null; // new analysis starts unreviewed
    const strip = renderVerdictStrip(current, async (verdict) => {
      if (!state.lastHistoryId) return;
      await updateAnalysisReview(state.lastHistoryId, {
        humanVerdict: verdict,
        notes: '',
        methodLabels: Object.fromEntries([...results.keys()].map(id => [id, 'unreviewed'])),
        reviewedAt: new Date().toISOString(),
      });
      showToast(`Verdict saved: ${verdict}`, 'success');
    });
    verdictContainer.innerHTML = '';
    verdictContainer.appendChild(strip);
  }
```

- [ ] **Step 4: Add verdict container to `index.html`**

In `index.html`, find the results section div (`id="results-section"`). Inside it, after the score cards div (`id="score-cards"`), add:
```html
<div id="verdict-strip-container"></div>
```

- [ ] **Step 5: Add verdict strip styles to `style.css`**

Append to `style.css`:
```css
/* Verdict strip */
.verdict-strip {
  margin: 16px 0;
  padding: 16px;
  border: 1px solid var(--border, #e5e5e5);
  background: #fff;
}

.verdict-strip-label {
  font-family: 'Oswald', sans-serif;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #71717a;
  margin-bottom: 10px;
}

.verdict-strip-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.verdict-btn {
  padding: 7px 16px;
  border: 1px solid #e5e5e5;
  background: #fff;
  font-family: 'Be Vietnam Pro', sans-serif;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.verdict-btn:hover {
  border-color: #bf080b;
}

.verdict-btn--active {
  background: #bf080b;
  color: #fff;
  border-color: #bf080b;
}
```

- [ ] **Step 6: Open app, run a comparison, verify verdict strip appears below score cards. Click a verdict button, verify toast "Verdict saved: similar" (or whichever). Navigate to History, verify the entry shows the selected verdict.**

- [ ] **Step 7: Commit**

```bash
git add src/ui.js src/main.js index.html style.css
git commit -m "feat: add inline verdict strip after analysis results"
```

---

### Task 2.4 — Method Performance panel in History

**Files:**
- Modify: `src/ui.js`
- Modify: `src/main.js`

- [ ] **Step 1: Add `renderMethodPerformancePanel` to `src/ui.js`**

Append to `src/ui.js`:
```js
/**
 * Render a method performance panel from pre-computed results.
 * @param {Array<{methodId: string, correlation: number, sampleSize: number}>} results
 * @param {number} labeledCount
 * @returns {HTMLElement}
 */
export function renderMethodPerformancePanel(results, labeledCount) {
  const panel = document.createElement('div');
  panel.className = 'method-perf-panel';

  const title = document.createElement('div');
  title.className = 'method-perf-title';
  title.textContent = 'METHOD PERFORMANCE';
  panel.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'method-perf-subtitle';
  subtitle.textContent = `Spearman rank correlation vs your verdicts · ${labeledCount} labeled entries`;
  panel.appendChild(subtitle);

  const table = document.createElement('table');
  table.className = 'method-perf-table';
  table.innerHTML = '<thead><tr><th>Method</th><th>Correlation</th><th>Samples</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');

  for (let i = 0; i < results.length; i++) {
    const { methodId, correlation, sampleSize } = results[i];
    const corr = correlation.toFixed(2);
    const badge = i === 0 ? '<span class="perf-best-badge">Best match</span>' : '';
    const colorClass = correlation >= 0.7 ? 'corr-high' : correlation >= 0.4 ? 'corr-medium' : 'corr-low';
    tbody.innerHTML += `
      <tr>
        <td><span class="method-badge">${methodId.toUpperCase()}</span></td>
        <td class="${colorClass}">${corr}</td>
        <td>${sampleSize}</td>
        <td>${badge}</td>
      </tr>
    `;
  }
  table.appendChild(tbody);
  panel.appendChild(table);
  return panel;
}
```

- [ ] **Step 2: Import `computeMethodPerformance` and `renderMethodPerformancePanel` in `src/main.js`**

Add to imports:
```js
import { computeMethodPerformance } from './methodEvaluator.js';
```
Add `renderMethodPerformancePanel` to the import from `./ui.js`.

- [ ] **Step 3: Update `renderHistoryStats` in `src/main.js` to add the performance panel**

Replace the entire `renderHistoryStats` function:
```js
function renderHistoryStats(entries) {
  const statsEl = $('history-stats');
  if (!statsEl) return;

  const labeled = entries.filter(
    e => e.review?.humanVerdict && e.review.humanVerdict !== 'unreviewed'
  );
  const perfResults = computeMethodPerformance(entries);

  statsEl.innerHTML = `
    <div class="history-stat-card"><div class="history-stat-label">Saved analyses</div><div class="history-stat-value">${entries.length}</div></div>
    <div class="history-stat-card"><div class="history-stat-label">Verdicts assigned</div><div class="history-stat-value">${labeled.length}</div></div>
    <div class="history-stat-card"><div class="history-stat-label">Need ${Math.max(0, 5 - labeled.length)} more verdicts</div><div class="history-stat-value">${labeled.length >= 5 ? '✓ Panel ready' : `${labeled.length}/5`}</div></div>
  `;

  const panelEl = $('history-perf-panel');
  if (!panelEl) return;
  panelEl.innerHTML = '';
  if (perfResults.length > 0) {
    panelEl.appendChild(renderMethodPerformancePanel(perfResults, labeled.length));
  }
}
```

- [ ] **Step 4: Add `history-perf-panel` div to `index.html` inside the history page**

In `index.html`, find the history page div. Inside it (after `id="history-stats"`), add:
```html
<div id="history-perf-panel"></div>
```

- [ ] **Step 5: Add performance panel styles to `style.css`**

Append to `style.css`:
```css
/* Method performance panel */
.method-perf-panel {
  border: 1px solid #e5e5e5;
  padding: 16px;
  margin: 16px 0;
  background: #fff;
}

.method-perf-title {
  font-family: 'Oswald', sans-serif;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #71717a;
  margin-bottom: 4px;
}

.method-perf-subtitle {
  font-size: 12px;
  color: #71717a;
  margin-bottom: 12px;
}

.method-perf-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.method-perf-table th,
.method-perf-table td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid #f0f0f0;
}

.perf-best-badge {
  background: #bf080b;
  color: #fff;
  font-size: 10px;
  padding: 2px 8px;
  font-family: 'Oswald', sans-serif;
  letter-spacing: 0.06em;
}

.corr-high { color: #16a34a; font-weight: 600; }
.corr-medium { color: #d97706; }
.corr-low { color: #71717a; }
```

- [ ] **Step 6: Open History page, assign verdicts to 5+ entries using the inline strip or History dropdown, verify the performance panel appears with correlation values and a "Best match" badge.**

- [ ] **Step 7: Commit**

```bash
git add src/ui.js src/main.js index.html style.css src/methodEvaluator.js
git commit -m "feat: add Method Performance panel in History (Spearman correlation vs verdicts)"
```

---

## PHASE 3 — wav2vec via ONNX

### Task 3.1 — `wav2vecMethod.js` with lazy model loading

**Files:**
- Create: `src/wav2vecMethod.js`
- Modify: `index.html` (importmap)

- [ ] **Step 1: Add importmap for `@xenova/transformers` to `index.html`**

In `index.html`, immediately after `<head>`:
```html
<script type="importmap">
{
  "imports": {
    "@xenova/transformers": "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js"
  }
}
</script>
```

Place this before any `<script type="module">` tags.

- [ ] **Step 2: Create `src/wav2vecMethod.js`**

```js
/**
 * wav2vecMethod.js — Lazy wav2vec2-base inference via @xenova/transformers (ONNX).
 * Model is downloaded (~90MB) on first use and cached by the browser.
 * No backend required — runs entirely in-browser via WebAssembly.
 */

const MODEL_ID = 'Xenova/wav2vec2-base';

// State: 'idle' | 'loading' | 'ready' | 'error'
let modelState = 'idle';
let extractor = null;
let modelError = null;
let loadPromise = null;
const stateListeners = new Set();

export function getModelState() {
  return { state: modelState, error: modelError };
}

export function onModelStateChange(fn) {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

function notifyListeners() {
  for (const fn of stateListeners) fn({ state: modelState, error: modelError });
}

async function loadModel() {
  if (modelState === 'ready') return;
  if (loadPromise) return loadPromise;

  modelState = 'loading';
  notifyListeners();

  loadPromise = (async () => {
    try {
      const { pipeline } = await import('@xenova/transformers');
      extractor = await pipeline('feature-extraction', MODEL_ID, {
        quantized: true,
        progress_callback: (info) => {
          if (info.status === 'progress') notifyListeners();
        },
      });
      modelState = 'ready';
      modelError = null;
    } catch (err) {
      modelState = 'error';
      modelError = err.message;
      extractor = null;
      loadPromise = null;
    }
    notifyListeners();
  })();

  return loadPromise;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom < 1e-10 ? 0 : dot / denom;
}

async function embedSamples(samples) {
  // transformers.js expects a Float32Array at 16kHz mono
  const output = await extractor(samples, { pooling: 'mean', normalize: true });
  return output.data; // Float32Array of embedding
}

export async function runWav2VecSimilarity(samplesA, samplesB) {
  if (modelState !== 'ready') await loadModel();
  if (modelState !== 'ready') {
    return { score: 0, label: `Model error: ${modelError}`, data: {} };
  }

  const [embA, embB] = await Promise.all([
    embedSamples(samplesA),
    embedSamples(samplesB),
  ]);

  const sim = cosineSimilarity(embA, embB);
  const score = Math.round(((sim + 1) / 2) * 100); // map [-1, 1] → [0, 100]

  return {
    score,
    label: score >= 80 ? 'Very similar' : score >= 60 ? 'Quite similar' : score >= 40 ? 'Somewhat similar' : 'Different',
    data: { cosineSim: sim },
  };
}

export { loadModel };
```

- [ ] **Step 3: Register wav2vec in `METHOD_DEFS` in `src/methods.js`**

Add this import at the top of `src/methods.js`:
```js
import { runWav2VecSimilarity, loadModel as loadWav2VecModel, getModelState } from './wav2vecMethod.js';
```

Add to the `METHOD_DEFS` array (before formant, after sflux):
```js
  {
    id: 'wav2vec',
    name: 'wav2vec Embedding',
    subtitle: 'Learned cross-language phonetic features · ~90MB first load',
    defaultOn: false,
    async: true,
    run: (a, b) => runWav2VecSimilarity(a, b),
  },
```

- [ ] **Step 4: Show loading state for wav2vec in the UI**

In `src/main.js`, in the `runComparison` function, before the `await runAnalysis(...)` call, add:
```js
  // If wav2vec is enabled and model isn't ready, show a toast with loading state
  if (state.enabledMethods.has('wav2vec')) {
    const { state: s } = getModelState();
    if (s === 'idle') {
      showToast('wav2vec: downloading model (~90MB), this may take a minute…', 'success');
    }
  }
```

Also add `getModelState` to the import from `./wav2vecMethod.js`:
```js
import { getModelState } from './wav2vecMethod.js';
```

Wait — `wav2vecMethod.js` isn't imported in `main.js` yet. Add:
```js
import { getModelState } from './wav2vecMethod.js';
```

- [ ] **Step 5: Open app, enable the wav2vec method card, run a comparison. Verify: toast "downloading model" appears on first run, model loads (may take 1-3 minutes on slow connection), score card for `wav2vec` appears with a cosine-derived score. Second run should be instant (cached).**

- [ ] **Step 6: Commit**

```bash
git add src/wav2vecMethod.js src/methods.js index.html src/main.js
git commit -m "feat: add wav2vec method via ONNX for cross-language phonetic embedding"
```

---

### Task 3.2 — Final verification pass

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no regressions).

- [ ] **Step 2: Open the app. Run 5+ comparisons with different audio pairs. Assign verdicts using the inline strip for each one.**

- [ ] **Step 3: Navigate to History. Verify the Method Performance panel appears with correlations for all enabled methods.**

- [ ] **Step 4: Check that the "Best match" badge highlights the method that best tracked your ear across those runs.**

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final verification — sound mirror method stack complete"
```

---

## Self-review

**Spec coverage:**
- ✅ MFCC-39 upgrade (Task 1.2, 1.6)
- ✅ LPC method (Task 1.3, 1.6)
- ✅ V/UV rhythm method (Task 1.4, 1.6)
- ✅ Spectral flux method (Task 1.5, 1.6)
- ✅ wav2vec via ONNX, lazy load, ~90MB (Task 3.1)
- ✅ wav2vec not defaultOn (Task 3.1 METHOD_DEFS)
- ✅ Audio playback on main page (Task 1.7)
- ✅ `runAnalysis` made async (Task 1.6 Step 7)
- ✅ 4-point verdict schema (Task 2.2)
- ✅ Inline verdict strip after analysis (Task 2.3)
- ✅ Verdict persisted to history entry (Task 2.3 Step 3)
- ✅ `methodEvaluator.js` pure module + tests (Task 2.1)
- ✅ Method Performance panel ≥5 labeled entries (Task 2.4)
- ✅ `methodLabels` kept per-method (METHOD_DEFS has all methods, methodLabels initialized in review)
- ✅ Pitch and rawcorr subtitle updated to "not a sound mirror method" (Task 1.6 Step 6)
- ✅ `analysisGoal` default updated to `'sound-mirror'` (Task 1.7 Step 3)

**Type consistency check:**
- `verdictToRank` returns `number | null` — consistent across methodEvaluator.js and tests
- `computeMethodPerformance` returns `Array<{methodId, correlation, sampleSize}>` — consistent with `renderMethodPerformancePanel` call in main.js
- `extractMFCCWithDeltas` returns `Array<Float64Array>` — passed directly to `dtw()` which expects `Array<Float64Array>` ✅
- `extractLPCFrames` returns `Array<Float64Array>` — passed to `dtw()` ✅
- `extractVoicedUnvoiced` returns `Float64Array` — wrapped via `Array.from(vuvA, v => new Float64Array([v]))` before `dtw()` ✅
- `extractSpectralFlux` returns `Float64Array` — passed via `dtwScalar()` ✅
