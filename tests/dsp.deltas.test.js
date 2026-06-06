import { describe, it, expect } from 'vitest';
import {
  extractMFCCWithDeltas,
  extractLPCFrames,
  extractVoicedUnvoiced,
  extractSpectralFlux,
} from '../src/dsp.js';

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
