/**
 * methods.js — M1–M3, M5–M6 analysis method runners
 * Each method returns { score: number (0-100), label: string, data: object }
 */

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

function simLabel(score) {
  if (score >= 80) return 'Very similar';
  if (score >= 60) return 'Quite similar';
  if (score >= 40) return 'Somewhat similar';
  return 'Different';
}

// ---------------------------------------------------------------------------
// M1 — MFCC-39 + DTW
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// M2 — Formant similarity
// ---------------------------------------------------------------------------
export function runFormantSimilarity(samplesA, samplesB) {
  const { f1: f1A, f2: f2A } = extractFormants(samplesA, 16000);
  const { f1: f1B, f2: f2B } = extractFormants(samplesB, 16000);

  if (!f1A || f1A.length < 2 || !f1B || f1B.length < 2) {
    return { score: 0, label: 'Insufficient voiced segments', data: {} };
  }

  const result = dtw2D(f1A, f2A, f1B, f2B);
  // Formant distances are in Hz; scale ~300 Hz maps ~30% distance → 100*e^(-1)≈37%
  const score = Math.round(distanceToSimilarity(result.distance, 300));

  return {
    score,
    label: simLabel(score),
    data: {
      formantsA: { f1: f1A, f2: f2A },
      formantsB: { f1: f1B, f2: f2B },
      dtwDist: result.distance,
    },
  };
}

// ---------------------------------------------------------------------------
// LPC + DTW
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// V/UV Rhythm
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Spectral Flux
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// M3 — Mel-spectrogram correlation
// ---------------------------------------------------------------------------
export function runMelSpectrogramSimilarity(samplesA, samplesB) {
  const specA = extractMelSpectrogram(samplesA, 16000, { numFilters: 40 });
  const specB = extractMelSpectrogram(samplesB, 16000, { numFilters: 40 });

  const sim = melSpectrogramSimilarity(specA, specB);
  const score = Math.round(sim * 100);

  return {
    score,
    label: simLabel(score),
    data: { specA, specB },
  };
}

// ---------------------------------------------------------------------------
// M5 — Pitch (F0) contour
// ---------------------------------------------------------------------------
export function runPitchSimilarity(samplesA, samplesB) {
  const pitchA = extractPitch(samplesA, 16000);
  const pitchB = extractPitch(samplesB, 16000);

  if (pitchA.length < 2 || pitchB.length < 2) {
    return { score: 0, label: 'Insufficient pitched frames', data: {} };
  }

  const result = dtwScalar(pitchA, pitchB);
  // Pitch distances are in Hz; scale 100 Hz is a good mid-range
  const score = Math.round(distanceToSimilarity(result.distance, 100));

  return {
    score,
    label: simLabel(score),
    data: { pitchA, pitchB, dtwDist: result.distance },
  };
}

// ---------------------------------------------------------------------------
// M6 — Raw cross-correlation
// ---------------------------------------------------------------------------
export function runRawCorrelation(samplesA, samplesB) {
  const sim = crossCorrelationSimilarity(samplesA, samplesB);
  const score = Math.round(sim * 100);

  return {
    score,
    label: simLabel(score),
    data: {},
  };
}

// ---------------------------------------------------------------------------
// Method registry
// ---------------------------------------------------------------------------
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

/**
 * Run all enabled methods.
 * @param {Float32Array} samplesA
 * @param {Float32Array} samplesB
 * @param {Set<string>} enabledIds
 * @param {object} opts
 * @returns {Map<string, {score, label, data, name}>}
 */
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
