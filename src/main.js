/**
 * main.js — App initialization, event wiring, analysis orchestration
 */

import { loadAudioFile, preprocessAudio, AudioRecorder, formatDuration } from './audio.js';
import { runAnalysis, METHOD_DEFS } from './methods.js';
import {
  renderMethodCards,
  createScoreCard,
  createComparisonTable,
  renderRadarChart,
  setSlotLoading,
  setSlotInfo,
  setSlotHasAudio,
  showToast,
  exportResultsToJSON,
} from './ui.js';
import {
  drawMiniWaveform,
  drawStackedWaveforms,
  drawMelSpectrogram,
  drawDTWPath,
} from './visualizations.js';

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const state = {
  audioA: null,
  audioB: null,
  processedA: null,
  processedB: null,
  enabledMethods: new Set(METHOD_DEFS.filter(m => m.defaultOn).map(m => m.id)),
  preprocessing: { normalize: false, trimSilence: false },
  lastResults: null,
  recorders: { a: new AudioRecorder(), b: new AudioRecorder() },
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);

function init() {
  // Preprocessing toggles
  $('toggle-normalize').addEventListener('change', e => {
    state.preprocessing.normalize = e.target.checked;
  });
  $('toggle-trim').addEventListener('change', e => {
    state.preprocessing.trimSilence = e.target.checked;
  });

  // Method cards
  renderMethodCards($('methods-container'), state.enabledMethods, (id, enabled) => {
    if (enabled) state.enabledMethods.add(id);
    else state.enabledMethods.delete(id);
    updateCompareButton();
  });

  // Audio slots
  setupSlot('a');
  setupSlot('b');

  // Compare button
  $('btn-compare').addEventListener('click', runComparison);

  // Export button
  $('btn-export').addEventListener('click', handleExport);

  updateCompareButton();
}

// ---------------------------------------------------------------------------
// Slot setup
// ---------------------------------------------------------------------------
function setupSlot(slot) {
  const slotEl = $(`slot-${slot}`);
  const uploadInput = $(`upload-${slot}`);
  const uploadBtn = $(`btn-upload-${slot}`);
  const recordBtn = $(`btn-record-${slot}`);
  const waveCanvas = $(`wave-preview-${slot}`);

  uploadBtn.addEventListener('click', () => uploadInput.click());

  uploadInput.addEventListener('change', async () => {
    const file = uploadInput.files[0];
    if (!file) return;
    uploadInput.value = '';
    try {
      setSlotLoading(slotEl, true);
      const audio = await loadAudioFile(file);
      state[`audio${slot.toUpperCase()}`] = audio;
      state[`processed${slot.toUpperCase()}`] = null;
      setSlotInfo(slotEl, `${file.name} · ${formatDuration(audio.duration)}`);
      setSlotHasAudio(slotEl, true);
      drawMiniWaveform(waveCanvas, audio.samples);
      updateCompareButton();
      showToast(`Audio ${slot.toUpperCase()} loaded`, 'success');
    } catch (err) {
      showToast(`Error loading file: ${err.message}`, 'error');
    } finally {
      setSlotLoading(slotEl, false);
    }
  });

  recordBtn.addEventListener('click', async () => {
    const recorder = state.recorders[slot];
    if (recorder.isRecording()) {
      try {
        recordBtn.textContent = '⏳ Stopping…';
        recordBtn.disabled = true;
        const audio = await recorder.stop();
        state[`audio${slot.toUpperCase()}`] = audio;
        state[`processed${slot.toUpperCase()}`] = null;
        const dur = formatDuration(audio.duration);
        setSlotInfo(slotEl, `Recording · ${dur}`);
        setSlotHasAudio(slotEl, true);
        drawMiniWaveform(waveCanvas, audio.samples);
        updateCompareButton();
        showToast(`Audio ${slot.toUpperCase()} recorded`, 'success');
      } catch (err) {
        showToast(`Recording error: ${err.message}`, 'error');
      } finally {
        recordBtn.textContent = '● Record';
        recordBtn.disabled = false;
        recordBtn.classList.remove('btn-record--active');
      }
    } else {
      try {
        await recorder.start();
        recordBtn.textContent = '■ Stop';
        recordBtn.classList.add('btn-record--active');
      } catch (err) {
        showToast(`Microphone error: ${err.message}`, 'error');
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------
async function runComparison() {
  if (!state.audioA || !state.audioB) return;
  if (state.enabledMethods.size === 0) {
    showToast('Enable at least one analysis method', 'error');
    return;
  }

  const btn = $('btn-compare');
  btn.disabled = true;
  btn.textContent = 'Analyzing…';
  $('results-section').style.display = 'none';

  try {
    // Preprocess
    const processOpts = state.preprocessing;
    const procA = preprocessAudio(state.audioA, processOpts);
    const procB = preprocessAudio(state.audioB, processOpts);
    state.processedA = procA;
    state.processedB = procB;

    // Run analysis (methods can be slow; yield to keep UI alive)
    await new Promise(r => setTimeout(r, 0));
    const results = runAnalysis(procA.samples, procB.samples, state.enabledMethods, {});
    state.lastResults = results;

    renderResults(results, procA, procB);
    $('results-section').style.display = 'block';
    $('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showToast(`Analysis failed: ${err.message}`, 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Compare';
  }
}

// ---------------------------------------------------------------------------
// Render results
// ---------------------------------------------------------------------------
function renderResults(results, procA, procB) {
  const entries = [...results.values()];

  // Score cards
  const cardsEl = $('score-cards');
  cardsEl.innerHTML = '';
  for (const result of entries) {
    cardsEl.appendChild(createScoreCard(result, result));
  }

  // Multi-method comparison
  const multiEl = $('multi-comparison');
  multiEl.innerHTML = '';
  if (entries.length > 1) {
    const methodEntries = entries.map(r => {
      const def = METHOD_DEFS.find(m => m.id === r.id);
      return { method: def, result: r };
    });
    multiEl.appendChild(createComparisonTable(methodEntries));

    const radarWrapper = document.createElement('div');
    radarWrapper.className = 'radar-wrapper';
    const radarCanvas = document.createElement('canvas');
    radarCanvas.id = 'radar-chart';
    radarWrapper.appendChild(radarCanvas);
    multiEl.appendChild(radarWrapper);

    renderRadarChart(radarCanvas, methodEntries);
    multiEl.style.display = 'block';
  } else {
    multiEl.style.display = 'none';
  }

  // Visualizations
  renderVisualizations(results, procA, procB);
}

function renderVisualizations(results, procA, procB) {
  const vizEl = $('viz-section');

  // Stacked waveforms
  const stackCanvas = $('canvas-waveforms');
  drawStackedWaveforms(stackCanvas, procA.samples, procB.samples);

  // Mel spectrograms — compute lazily for display
  renderSpectrograms(procA.samples, procB.samples);

  // DTW path (if M1 ran)
  const mfccResult = results.get('mfcc');
  const dtwSection = $('dtw-section');
  if (mfccResult && mfccResult.data.matrix) {
    const dtwCanvas = $('canvas-dtw');
    const { matrix, rows, cols, path } = mfccResult.data;
    drawDTWPath(dtwCanvas, matrix, rows, cols, path);
    dtwSection.style.display = 'block';
  } else {
    dtwSection.style.display = 'none';
  }

  vizEl.style.display = 'block';
}

function renderSpectrograms(samplesA, samplesB) {
  // Import lazily to avoid blocking
  import('./dsp.js').then(({ extractMelSpectrogram }) => {
    const specA = extractMelSpectrogram(samplesA, 16000, { numFilters: 40 });
    const specB = extractMelSpectrogram(samplesB, 16000, { numFilters: 40 });
    drawMelSpectrogram($('canvas-spec-a'), specA, { label: 'A' });
    drawMelSpectrogram($('canvas-spec-b'), specB, { label: 'B' });
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function handleExport() {
  if (!state.lastResults) return;
  const entries = [...state.lastResults.values()];
  exportResultsToJSON(
    entries.map(r => {
      const def = METHOD_DEFS.find(m => m.id === r.id);
      return { method: def, result: r };
    }),
    {
      a: { fileName: state.audioA?.fileName, duration: state.audioA?.duration },
      b: { fileName: state.audioB?.fileName, duration: state.audioB?.duration },
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function updateCompareButton() {
  const btn = $('btn-compare');
  const ready = state.audioA && state.audioB && state.enabledMethods.size > 0;
  btn.disabled = !ready;
}

// Boot
document.addEventListener('DOMContentLoaded', init);
