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

  // Export + AI explanation buttons
  $('btn-export').addEventListener('click', handleExport);
  $('btn-ai-analyze')?.addEventListener('click', handleAIAnalysis);

  setupLLMSettings();
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
// LLM settings + AI result explanation (9Router / OpenAI-compatible)
// ---------------------------------------------------------------------------
const LLM_STORAGE_KEYS = {
  endpoint: 'chunks.llm.endpoint',
  apiKey: 'chunks.llm.apiKey',
  model: 'chunks.llm.model',
};

function setupLLMSettings() {
  const endpointEl = $('llm-endpoint');
  const keyEl = $('llm-api-key');
  const modelSelectEl = $('llm-model-select');
  const modelCustomEl = $('llm-model-custom');
  if (!endpointEl || !keyEl || !modelSelectEl || !modelCustomEl) return;

  endpointEl.value = localStorage.getItem(LLM_STORAGE_KEYS.endpoint) || 'http://localhost:20128';
  keyEl.value = localStorage.getItem(LLM_STORAGE_KEYS.apiKey) || '';
  modelCustomEl.value = localStorage.getItem(LLM_STORAGE_KEYS.model) || '';
  if (modelCustomEl.value) addModelOption(modelSelectEl, modelCustomEl.value, true);

  modelSelectEl.addEventListener('change', () => {
    if (modelSelectEl.value) modelCustomEl.value = modelSelectEl.value;
  });
  $('btn-save-llm-settings')?.addEventListener('click', saveLLMSettings);
  $('btn-load-models')?.addEventListener('click', loadLLMModels);
  $('btn-test-llm-model')?.addEventListener('click', testLLMModel);
  setLLMStatus('Cấu hình 9Router/OpenAI-compatible endpoint, sau đó Load models hoặc Test model.');
}

function getLLMSettings() {
  return {
    endpoint: ($('llm-endpoint')?.value || '').trim().replace(/\/$/, ''),
    apiKey: $('llm-api-key')?.value || '',
    model: (($('llm-model-custom')?.value || $('llm-model-select')?.value || '').trim()),
  };
}

function saveLLMSettings() {
  const settings = getLLMSettings();
  if (!settings.endpoint) return setLLMStatus('Thiếu API endpoint.', true);
  if (!settings.model) return setLLMStatus('Thiếu model ID.', true);
  localStorage.setItem(LLM_STORAGE_KEYS.endpoint, settings.endpoint);
  localStorage.setItem(LLM_STORAGE_KEYS.apiKey, settings.apiKey);
  localStorage.setItem(LLM_STORAGE_KEYS.model, settings.model);
  setLLMStatus(`Đã lưu settings. Endpoint: ${settings.endpoint}\nModel: ${settings.model}`);
  showToast('LLM settings saved', 'success');
}

async function loadLLMModels() {
  const settings = getLLMSettings();
  if (!settings.endpoint) return setLLMStatus('Thiếu API endpoint.', true);
  setLLMStatus('Đang tải danh sách models…');
  try {
    const res = await fetch(`${settings.endpoint}/v1/models`, {
      headers: buildLLMHeaders(settings, false),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = await res.json();
    const models = Array.isArray(data.data) ? data.data : [];
    const select = $('llm-model-select');
    select.innerHTML = '<option value="">Chọn model…</option>';
    for (const model of models) addModelOption(select, model.id, model.id === settings.model);
    if (settings.model) $('llm-model-custom').value = settings.model;
    setLLMStatus(`Loaded ${models.length} models. Chọn model rồi bấm Test model.`);
  } catch (err) {
    setLLMStatus(`Load models failed: ${err.message}`, true);
  }
}

async function testLLMModel() {
  const settings = getLLMSettings();
  if (!settings.endpoint || !settings.model) return setLLMStatus('Thiếu endpoint hoặc model ID.', true);
  setLLMStatus('Đang test model…');
  try {
    const text = await callLLM(settings, [
      { role: 'system', content: 'Bạn là model test. Trả lời ngắn gọn bằng tiếng Việt.' },
      { role: 'user', content: 'Trả lời đúng một câu: Kết nối LLM hoạt động.' },
    ], 80);
    saveLLMSettings();
    setLLMStatus(`Test OK:\n${text}`);
  } catch (err) {
    setLLMStatus(`Test model failed: ${err.message}`, true);
  }
}

async function handleAIAnalysis() {
  if (!state.lastResults) {
    showToast('Run Compare before AI analysis', 'error');
    return;
  }
  const settings = getLLMSettings();
  if (!settings.endpoint || !settings.model) {
    showToast('Configure LLM settings first', 'error');
    document.getElementById('tab-settings')?.click();
    return;
  }

  const panel = $('ai-analysis-panel');
  const output = $('ai-analysis-output');
  panel.style.display = 'block';
  output.textContent = 'Đang gửi summary JSON cho LLM phân tích…';

  try {
    const summary = buildAnalysisSummary();
    const text = await callLLM(settings, [
      {
        role: 'system',
        content: 'Bạn là chuyên gia giải thích kết quả audio similarity. Trả lời bằng tiếng Việt, dễ hiểu, không khẳng định quá mức. Không yêu cầu dữ liệu audio gốc.',
      },
      {
        role: 'user',
        content: `Hãy đọc JSON kết quả sau và đưa đánh giá cơ bản:\n- Tóm tắt mức độ giống nhau tổng thể\n- Method nào đáng tin hơn trong tình huống này\n- Điểm nào cần thận trọng\n- Gợi ý bước kiểm tra tiếp theo\n\nJSON:\n${JSON.stringify(summary, null, 2)}`,
      },
    ], 900);
    output.textContent = text;
  } catch (err) {
    output.textContent = `AI analysis failed: ${err.message}`;
    showToast('AI analysis failed', 'error');
  }
}

function buildAnalysisSummary() {
  const entries = [...state.lastResults.values()];
  const methods = entries.map(r => ({
    id: r.id,
    name: r.name,
    score: Math.round(r.score),
    label: r.label,
    technical: summarizeResultData(r.data),
  }));
  const scores = methods.map(m => m.score).filter(Number.isFinite);
  return {
    generatedAt: new Date().toISOString(),
    audio: {
      a: { fileName: state.audioA?.fileName || 'Recording/Audio A', durationSeconds: round2(state.audioA?.duration) },
      b: { fileName: state.audioB?.fileName || 'Recording/Audio B', durationSeconds: round2(state.audioB?.duration) },
    },
    preprocessing: state.preprocessing,
    methods,
    aggregate: scores.length ? {
      averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      minScore: Math.min(...scores),
      maxScore: Math.max(...scores),
      enabledMethodCount: methods.length,
    } : null,
    note: 'Scores are heuristic acoustic feature similarity only, not ground truth.',
  };
}

function summarizeResultData(data = {}) {
  return {
    dtwDistance: round2(data.dtwDist),
    hasDtwPath: Array.isArray(data.path),
    mfccFramesA: data.mfccA?.length,
    mfccFramesB: data.mfccB?.length,
    formantFramesA: data.formantsA?.f1?.length,
    formantFramesB: data.formantsB?.f1?.length,
    pitchFramesA: data.pitchA?.length,
    pitchFramesB: data.pitchB?.length,
    spectrogramFramesA: data.specA?.length,
    spectrogramFramesB: data.specB?.length,
  };
}

async function callLLM(settings, messages, maxTokens = 800) {
  const res = await fetch(`${settings.endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: buildLLMHeaders(settings, true),
    body: JSON.stringify({ model: settings.model, messages, max_tokens: maxTokens, stream: false }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || JSON.stringify(data, null, 2);
}

function buildLLMHeaders(settings, jsonBody) {
  const headers = {};
  if (jsonBody) headers['Content-Type'] = 'application/json';
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  return headers;
}

function addModelOption(select, id, selected = false) {
  if (!id || [...select.options].some(opt => opt.value === id)) return;
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = id;
  opt.selected = selected;
  select.appendChild(opt);
}

function setLLMStatus(message, isError = false) {
  const el = $('llm-settings-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('llm-status--error', isError);
}

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
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
