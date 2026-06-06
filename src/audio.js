/**
 * audio.js — Audio loading, recording, preprocessing
 */

import { resample, toMono, normalizeSamples, trimSilence } from './dsp.js';

const TARGET_SAMPLE_RATE = 16000;

/**
 * Decode an ArrayBuffer containing encoded audio to a processed AudioBuffer-like object.
 * Returns { samples: Float32Array, sampleRate: number, duration: number }
 */
export async function decodeAudioFile(arrayBuffer) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const samples = extractMono(audioBuffer);
    return {
      samples,
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration,
      originalBuffer: audioBuffer,
    };
  } finally {
    await audioCtx.close();
  }
}

/**
 * Extract mono Float32Array from an AudioBuffer.
 */
function extractMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0).slice();
  }
  // Mix down to mono
  const len = audioBuffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const ch = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += ch[i];
  }
  for (let i = 0; i < len; i++) mono[i] /= audioBuffer.numberOfChannels;
  return mono;
}

/**
 * Preprocess audio samples:
 *   - Resample to TARGET_SAMPLE_RATE (16kHz)
 *   - Optionally normalize loudness
 *   - Optionally trim silence
 *
 * @param {{ samples: Float32Array, sampleRate: number }} audio
 * @param {{ normalize: boolean, trimSilence: boolean }} opts
 * @returns {{ samples: Float32Array, sampleRate: number }}
 */
export function preprocessAudio(audio, opts = {}) {
  let { samples, sampleRate } = audio;

  // Resample to 16kHz
  if (sampleRate !== TARGET_SAMPLE_RATE) {
    samples = resample(samples, sampleRate, TARGET_SAMPLE_RATE);
    sampleRate = TARGET_SAMPLE_RATE;
  }

  if (opts.trimSilence) {
    samples = trimSilence(samples, sampleRate);
  }

  if (opts.normalize) {
    samples = normalizeSamples(samples);
  }

  return { samples, sampleRate };
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.stream = null;
    this._resolve = null;
    this._reject = null;
  }

  async start() {
    this.chunks = [];
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      throw new Error('Microphone access denied: ' + err.message);
    }

    const mimeType = getSupportedMimeType();
    this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {});

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.start(100); // collect in 100ms chunks
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        reject(new Error('Not recording'));
        return;
      }
      this.mediaRecorder.onstop = async () => {
        const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        this.stream.getTracks().forEach(t => t.stop());
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audio = await decodeAudioFile(arrayBuffer);
          audio.blob = blob;
          audio.fileName = `Recording ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
          audio.fileSize = blob.size;
          audio.mimeType = blob.type || mimeType;
          resolve(audio);
        } catch (err) {
          reject(err);
        }
      };
      this.mediaRecorder.stop();
    });
  }

  cancel() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }
  }

  isRecording() {
    return this.mediaRecorder && this.mediaRecorder.state === 'recording';
  }
}

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

/**
 * Load audio from a File object.
 */
export async function loadAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audio = await decodeAudioFile(arrayBuffer);
  audio.fileName = file.name;
  audio.fileSize = file.size;
  audio.mimeType = file.type || 'audio/*';
  audio.blob = file;
  return audio;
}

/**
 * Format duration in seconds to mm:ss.
 */
export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
