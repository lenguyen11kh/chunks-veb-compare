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
import {
  clearAnalysisHistory,
  deleteAnalysisEntry,
  getAnalysisEntry,
  listAnalysisEntries,
  patchAnalysisEntry,
  saveAnalysisEntry,
  updateAnalysisReview,
} from './historyStore.js?v=2';

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const state = {
  audioA: null,
  audioB: null,
  processedA: null,
  processedB: null,
  enabledMethods: new Set(METHOD_DEFS.filter(m => m.defaultOn).map(m => m.id)),
  preprocessing: { normalize: true, trimSilence: true },
  analysisGoal: 'sound-mirror',
  lastResults: null,
  lastHistoryId: null,
  selectedHistoryId: null,
  historyObjectUrls: [],
  slotPlaybackUrls: { a: null, b: null },
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

  setupAnalysisGoal();

  // Method cards
  renderMethods();
  $('btn-enable-all-methods')?.addEventListener('click', enableAllMethods);

  // Audio slots
  setupSlot('a');
  setupSlot('b');

  // Compare + restart buttons
  $('btn-compare').addEventListener('click', runComparison);
  $('btn-restart')?.addEventListener('click', restartAnalysis);

  // Export + AI explanation buttons
  $('btn-export').addEventListener('click', handleExport);
  $('btn-ai-analyze')?.addEventListener('click', handleAIAnalysis);

  setupLLMSettings();
  setupHistoryPage();
  updateCompareButton();
}

// ---------------------------------------------------------------------------
// Analysis goal setup
// ---------------------------------------------------------------------------
function setupAnalysisGoal() {
  const goalEl = $('analysis-goal');
  if (!goalEl) return;
  goalEl.value = state.analysisGoal;
  updateAnalysisGoalDescription();
  goalEl.addEventListener('change', () => {
    state.analysisGoal = goalEl.value;
    updateAnalysisGoalDescription();
  });
}

function updateAnalysisGoalDescription() {
  const descEl = $('analysis-goal-description');
  if (!descEl) return;
  descEl.textContent = getAnalysisGoalConfig(state.analysisGoal).description;
}

// ---------------------------------------------------------------------------
// Method setup
// ---------------------------------------------------------------------------
function renderMethods() {
  renderMethodCards($('methods-container'), state.enabledMethods, handleMethodToggle);
}

function handleMethodToggle(id, enabled) {
  if (enabled) state.enabledMethods.add(id);
  else state.enabledMethods.delete(id);
  updateCompareButton();
}

function enableAllMethods() {
  state.enabledMethods = new Set(METHOD_DEFS.map(method => method.id));
  renderMethods();
  updateCompareButton();
  showToast('All analysis methods enabled', 'success');
}

function resetMethodDefaults() {
  state.enabledMethods = new Set(METHOD_DEFS.filter(m => m.defaultOn).map(m => m.id));
  renderMethods();
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
      setSlotPlayback(slotEl, slot, audio);
      setSlotHasAudio(slotEl, true);
      drawMiniWaveform(waveCanvas, audio.samples);
      updateCompareButton();
      clearPreviousResults();
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
        setSlotPlayback(slotEl, slot, audio);
        setSlotHasAudio(slotEl, true);
        drawMiniWaveform(waveCanvas, audio.samples);
        updateCompareButton();
        clearPreviousResults();
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
// Restart + compare
// ---------------------------------------------------------------------------
function restartAnalysis() {
  resetAudioSlots();
  resetPreprocessingDefaults();
  resetAnalysisGoalDefault();
  resetMethodDefaults();

  state.lastResults = null;
  state.processedA = null;
  state.processedB = null;
  clearPreviousResults();
  updateCompareButton();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('Sound Mirror restarted — fresh page state', 'success');
}

function resetAudioSlots() {
  for (const slot of ['a', 'b']) {
    const recorder = state.recorders[slot];
    recorder.cancel?.();
    state[`audio${slot.toUpperCase()}`] = null;
    state[`processed${slot.toUpperCase()}`] = null;
    const slotEl = $(`slot-${slot}`);
    const uploadInput = $(`upload-${slot}`);
    const recordBtn = $(`btn-record-${slot}`);
    const waveCanvas = $(`wave-preview-${slot}`);
    if (uploadInput) uploadInput.value = '';
    if (recordBtn) {
      recordBtn.textContent = '● Record';
      recordBtn.disabled = false;
      recordBtn.classList.remove('btn-record--active');
    }
    if (slotEl) {
      setSlotInfo(slotEl, 'No audio loaded');
      setSlotPlayback(slotEl, slot, null);
      setSlotHasAudio(slotEl, false);
      setSlotLoading(slotEl, false);
    }
    clearCanvas(waveCanvas);
  }
}

function resetPreprocessingDefaults() {
  state.preprocessing = { normalize: true, trimSilence: true };
  const normalizeEl = $('toggle-normalize');
  const trimEl = $('toggle-trim');
  if (normalizeEl) normalizeEl.checked = true;
  if (trimEl) trimEl.checked = true;
}

function resetAnalysisGoalDefault() {
  state.analysisGoal = 'sound-mirror';
  const goalEl = $('analysis-goal');
  if (goalEl) goalEl.value = state.analysisGoal;
  updateAnalysisGoalDescription();
}

function clearPreviousResults() {
  state.lastResults = null;
  const resultsSection = $('results-section');
  const aiPanel = $('ai-analysis-panel');
  const aiOutput = $('ai-analysis-output');
  if (resultsSection) resultsSection.style.display = 'none';
  if (aiPanel) aiPanel.style.display = 'none';
  state.lastHistoryId = null;
  if (aiOutput) aiOutput.textContent = 'Chưa có phân tích AI.';
  ['score-cards', 'multi-comparison'].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = '';
  });
  const vizEl = $('viz-section');
  if (vizEl) vizEl.style.display = 'none';
}

function setSlotPlayback(slotEl, slot, audio) {
  const el = slotEl?.querySelector('.slot-playback');
  if (!el) return;

  const prevUrl = state.slotPlaybackUrls[slot];
  if (prevUrl) URL.revokeObjectURL(prevUrl);

  if (!audio?.blob) {
    state.slotPlaybackUrls[slot] = null;
    el.innerHTML = '';
    return;
  }

  const url = URL.createObjectURL(audio.blob);
  state.slotPlaybackUrls[slot] = url;
  el.innerHTML = `<audio controls preload="metadata" src="${url}"></audio>`;
}

function clearCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

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
    const results = await runAnalysis(procA.samples, procB.samples, state.enabledMethods, {});
    state.lastResults = results;

    renderResults(results, procA, procB);
    await saveCurrentAnalysisToHistory();
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
// Local History / Admin Review
// ---------------------------------------------------------------------------
function setupHistoryPage() {
  $('tab-history')?.addEventListener('click', () => renderHistoryPage());
  $('btn-refresh-history')?.addEventListener('click', () => renderHistoryPage(state.selectedHistoryId));
  $('btn-clear-history')?.addEventListener('click', async () => {
    if (!confirm('Clear all saved audio history and review tags from this browser?')) return;
    try {
      await clearAnalysisHistory();
      revokeHistoryObjectUrls();
      state.selectedHistoryId = null;
      await renderHistoryPage();
      showToast('History cleared', 'success');
    } catch (err) {
      showToast(`Clear history failed: ${err.message}`, 'error');
    }
  });
}

async function saveCurrentAnalysisToHistory() {
  if (!state.lastResults || !state.audioA?.blob || !state.audioB?.blob) {
    showToast('Analysis ran, but audio blobs were not available for History.', 'error');
    return null;
  }

  const summary = buildAnalysisSummary();
  const id = generateId();
  const entry = {
    id,
    createdAt: summary.generatedAt,
    updatedAt: summary.generatedAt,
    summary,
    audioA: state.audioA.blob,
    audioB: state.audioB.blob,
    audioMeta: {
      a: buildAudioMeta(state.audioA),
      b: buildAudioMeta(state.audioB),
    },
    review: createDefaultReview(summary),
    aiExplanation: '',
  };

  try {
    await saveAnalysisEntry(entry);
    state.lastHistoryId = id;
    showToast('Saved audio + analysis log to History', 'success');
    if ($('page-history')?.style.display !== 'none') await renderHistoryPage(id);
    return id;
  } catch (err) {
    showToast(`Save history failed: ${err.message}`, 'error');
    console.error(err);
    return null;
  }
}

async function renderHistoryPage(selectedId = null) {
  const listEl = $('history-list');
  const detailEl = $('history-detail');
  if (!listEl || !detailEl) return;

  try {
    const entries = await listAnalysisEntries();
    renderHistoryStats(entries);

    if (!entries.length) {
      listEl.innerHTML = '<div class="empty-state">No saved analyses yet. Run Compare to save audio + logs here.</div>';
      detailEl.className = 'history-detail empty-state';
      detailEl.textContent = 'No history item selected.';
      state.selectedHistoryId = null;
      revokeHistoryObjectUrls();
      return;
    }

    const activeId = selectedId || state.selectedHistoryId || entries[0].id;
    state.selectedHistoryId = activeId;
    listEl.innerHTML = entries.map(entry => renderHistoryListItem(entry, activeId)).join('');
    listEl.querySelectorAll('[data-history-id]').forEach(btn => {
      btn.addEventListener('click', () => renderHistoryPage(btn.dataset.historyId));
    });

    const activeEntry = await getAnalysisEntry(activeId) || entries[0];
    await renderHistoryDetail(activeEntry);
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">History failed: ${escapeHtml(err.message)}</div>`;
  }
}

function renderHistoryStats(entries) {
  const statsEl = $('history-stats');
  if (!statsEl) return;

  const reviewed = entries.filter(entry => entry.review?.humanVerdict && entry.review.humanVerdict !== 'unreviewed').length;
  const methodStats = computeMethodStats(entries);
  const bestMethod = Object.entries(methodStats)
    .filter(([, stat]) => stat.total > 0)
    .sort(([, a], [, b]) => (b.correct / b.total) - (a.correct / a.total))[0];
  const bestLabel = bestMethod
    ? `${getMethodName(bestMethod[0])}: ${Math.round((bestMethod[1].correct / bestMethod[1].total) * 100)}%`
    : 'Not enough tags';

  statsEl.innerHTML = `
    <div class="history-stat-card"><div class="history-stat-label">Saved analyses</div><div class="history-stat-value">${entries.length}</div></div>
    <div class="history-stat-card"><div class="history-stat-label">Human reviewed</div><div class="history-stat-value">${reviewed}</div></div>
    <div class="history-stat-card"><div class="history-stat-label">Best tagged method</div><div class="history-stat-value">${escapeHtml(bestLabel)}</div></div>
  `;
}

function computeMethodStats(entries) {
  const stats = {};
  for (const method of METHOD_DEFS) stats[method.id] = { correct: 0, wrong: 0, unsure: 0, total: 0 };
  for (const entry of entries) {
    const labels = entry.review?.methodLabels || {};
    for (const [methodId, label] of Object.entries(labels)) {
      if (!stats[methodId] || label === 'unreviewed') continue;
      if (label in stats[methodId]) stats[methodId][label] += 1;
      stats[methodId].total += 1;
    }
  }
  return stats;
}

function renderHistoryListItem(entry, activeId) {
  const summary = entry.summary || {};
  const scores = (summary.methods || []).map(method => `
    <span class="history-score-pill">${escapeHtml(method.id.toUpperCase())}: ${escapeHtml(String(method.score))}</span>
  `).join('');
  return `
    <button class="history-item ${entry.id === activeId ? 'history-item--active' : ''}" type="button" data-history-id="${escapeHtml(entry.id)}">
      <div class="history-item-title">${escapeHtml(formatHistoryDate(entry.createdAt))}</div>
      <div class="history-item-meta">${escapeHtml(summary.analysisGoal?.label || 'Analysis')} · Avg ${escapeHtml(String(summary.aggregate?.averageScore ?? 'n/a'))}</div>
      <div class="history-item-meta">A: ${escapeHtml(summary.audio?.a?.fileName || 'Audio A')}<br>B: ${escapeHtml(summary.audio?.b?.fileName || 'Audio B')}</div>
      <div class="history-item-scores">${scores}</div>
    </button>
  `;
}

async function renderHistoryDetail(entry) {
  const detailEl = $('history-detail');
  if (!detailEl || !entry) return;

  revokeHistoryObjectUrls();
  const audioAUrl = entry.audioA ? URL.createObjectURL(entry.audioA) : '';
  const audioBUrl = entry.audioB ? URL.createObjectURL(entry.audioB) : '';
  state.historyObjectUrls = [audioAUrl, audioBUrl].filter(Boolean);

  const summary = entry.summary || {};
  const review = entry.review || createDefaultReview(summary);
  const methods = summary.methods || [];
  detailEl.className = 'history-detail';
  detailEl.innerHTML = `
    <div class="history-audio-grid">
      ${renderHistoryAudioCard('Audio A', summary.audio?.a, entry.audioMeta?.a, audioAUrl)}
      ${renderHistoryAudioCard('Audio B', summary.audio?.b, entry.audioMeta?.b, audioBUrl)}
    </div>

    <table class="history-score-table">
      <thead><tr><th>Method</th><th>Score</th><th>Label</th><th>Technical</th></tr></thead>
      <tbody>${methods.map(renderHistoryScoreRow).join('')}</tbody>
    </table>

    <div class="history-review">
      <h4>Admin human review</h4>
      <div class="history-review-grid">
        <label class="settings-field">
          <span>Human verdict</span>
          <select id="history-human-verdict">
            ${renderSelectOption('unreviewed', 'Unreviewed', review.humanVerdict)}
            ${renderSelectOption('very-similar', 'Very Similar', review.humanVerdict)}
            ${renderSelectOption('similar', 'Similar', review.humanVerdict)}
            ${renderSelectOption('different', 'Different', review.humanVerdict)}
            ${renderSelectOption('very-different', 'Very Different', review.humanVerdict)}
          </select>
        </label>
        <label class="settings-field">
          <span>Review notes</span>
          <textarea id="history-review-notes" placeholder="Nghe lại audio và ghi chú vì sao method đúng/sai…">${escapeHtml(review.notes || '')}</textarea>
        </label>
      </div>
      <div class="method-review-list">
        ${methods.map(method => renderMethodReviewControl(method, review.methodLabels?.[method.id])).join('')}
      </div>
      <div class="history-actions">
        <button class="btn btn-primary" id="btn-save-history-review" type="button">Save review tags</button>
        <button class="btn btn-outline" id="btn-delete-history-entry" type="button">Delete this item</button>
      </div>
    </div>

    ${entry.aiExplanation ? `<div class="history-log"><h4>Saved AI explanation</h4><pre>${escapeHtml(entry.aiExplanation)}</pre></div>` : ''}
    <div class="history-log"><h4>Saved analysis JSON</h4><pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre></div>
  `;

  $('btn-save-history-review')?.addEventListener('click', () => saveHistoryReview(entry.id));
  $('btn-delete-history-entry')?.addEventListener('click', () => deleteHistoryItem(entry.id));
}

function renderHistoryAudioCard(title, summaryMeta = {}, blobMeta = {}, audioUrl) {
  return `
    <div class="history-audio-card">
      <h4>${escapeHtml(title)}</h4>
      <div>${escapeHtml(summaryMeta.fileName || blobMeta.fileName || title)}</div>
      <div class="history-item-meta">Duration: ${escapeHtml(String(summaryMeta.durationSeconds ?? 'n/a'))}s · Size: ${escapeHtml(formatBytes(blobMeta.fileSize))}</div>
      ${audioUrl ? `<audio controls preload="metadata" src="${audioUrl}"></audio>` : '<div class="empty-state">Audio blob unavailable.</div>'}
    </div>
  `;
}

function renderHistoryScoreRow(method) {
  return `
    <tr>
      <td><span class="method-badge">${escapeHtml(method.id.toUpperCase())}</span>${escapeHtml(method.name || '')}</td>
      <td class="score-cell">${escapeHtml(String(method.score))}</td>
      <td>${escapeHtml(method.label || '')}</td>
      <td><pre>${escapeHtml(JSON.stringify(method.technical || {}, null, 2))}</pre></td>
    </tr>
  `;
}

function renderMethodReviewControl(method, value = 'unreviewed') {
  return `
    <div class="method-review-item">
      <label>${escapeHtml(method.id.toUpperCase())} · ${escapeHtml(String(method.score))}
        <select data-method-review="${escapeHtml(method.id)}">
          ${renderSelectOption('unreviewed', 'Unreviewed', value)}
          ${renderSelectOption('correct', 'Method was correct', value)}
          ${renderSelectOption('wrong', 'Method was wrong', value)}
          ${renderSelectOption('unsure', 'Unsure / partial', value)}
        </select>
      </label>
    </div>
  `;
}

function renderSelectOption(value, label, selectedValue) {
  return `<option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

async function saveHistoryReview(entryId) {
  const methodLabels = {};
  document.querySelectorAll('[data-method-review]').forEach(select => {
    methodLabels[select.dataset.methodReview] = select.value;
  });
  const review = {
    humanVerdict: $('history-human-verdict')?.value || 'unreviewed',
    notes: $('history-review-notes')?.value || '',
    methodLabels,
    reviewedAt: new Date().toISOString(),
  };

  try {
    await updateAnalysisReview(entryId, review);
    showToast('Review tags saved', 'success');
    await renderHistoryPage(entryId);
  } catch (err) {
    showToast(`Save review failed: ${err.message}`, 'error');
  }
}

async function deleteHistoryItem(entryId) {
  if (!confirm('Delete this saved analysis and its audio from this browser?')) return;
  try {
    await deleteAnalysisEntry(entryId);
    state.selectedHistoryId = null;
    showToast('History item deleted', 'success');
    await renderHistoryPage();
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

function createDefaultReview(summary = {}) {
  const methodLabels = {};
  for (const method of summary.methods || []) methodLabels[method.id] = 'unreviewed';
  return {
    humanVerdict: 'unreviewed',
    notes: '',
    methodLabels,
    reviewedAt: null,
  };
}

function buildAudioMeta(audio) {
  return {
    fileName: audio?.fileName || 'Audio',
    fileSize: audio?.fileSize || audio?.blob?.size || 0,
    mimeType: audio?.mimeType || audio?.blob?.type || 'audio/*',
    durationSeconds: round2(audio?.duration),
  };
}

function revokeHistoryObjectUrls() {
  for (const url of state.historyObjectUrls) URL.revokeObjectURL(url);
  state.historyObjectUrls = [];
}

function generateId() {
  return crypto.randomUUID?.() || `hist-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getMethodName(methodId) {
  return METHOD_DEFS.find(method => method.id === methodId)?.name || methodId;
}

function formatHistoryDate(value) {
  if (!value) return 'Unknown date';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatBytes(bytes = 0) {
  if (!bytes) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
        content: `Bạn là chuyên gia giải thích kết quả audio similarity cho CHUNKS. Trả lời bằng tiếng Việt, dễ hiểu, không khẳng định quá mức. Không yêu cầu dữ liệu audio gốc. Nhiệm vụ chính là trả lời đúng mục tiêu phân tích đã chọn: "${summary.analysisGoal.question}".`,
      },
      {
        role: 'user',
        content: `Đọc JSON kết quả và đưa verdict theo đúng analysisGoal, không chỉ tóm tắt điểm số.

Bắt buộc trả lời theo format:
1. **Kết luận** → Similar / Different / Inconclusive cho câu hỏi: ${summary.analysisGoal.question}
2. **Độ tin cậy** → Low / Medium / High, kèm lý do ngắn.
3. **Bằng chứng chính** → method nào quyết định nhiều nhất và vì sao.
4. **Mâu thuẫn / cảnh báo dữ liệu** → độ dài, frame lệch, trim silence, method nhiễu.
5. **Bước tiếp theo** → hành động cụ thể để làm kết quả đáng tin hơn.

Quy tắc diễn giải:
- Ưu tiên theo analysisGoal.reliabilityOrder, không lấy average score làm bằng chứng duy nhất.
- Nếu duration quá ngắn, frame lệch lớn, hoặc nhiều method mâu thuẫn: kết luận Inconclusive hoặc giảm confidence.
- Với same-speaker: không gọi đây là xác thực danh tính; chỉ nói giống/khác về đặc trưng âm học.
- Nếu score chính < 45 và đa số method thấp: nghiêng Different.
- Nếu score chính > 70 và method hỗ trợ cùng cao: nghiêng Similar.
- Vùng 45–70 hoặc dữ liệu kém: nghiêng Inconclusive/Partial.

JSON:
${JSON.stringify(summary, null, 2)}`,
      },
    ], 900);
    output.textContent = text;
    if (state.lastHistoryId) {
      try {
        await patchAnalysisEntry(state.lastHistoryId, { aiExplanation: text });
      } catch (historyErr) {
        console.warn('Could not save AI explanation to history:', historyErr);
      }
    }
  } catch (err) {
    output.textContent = `AI analysis failed: ${err.message}`;
    showToast('AI analysis failed', 'error');
  }
}

function buildAnalysisSummary() {
  const entries = [...state.lastResults.values()];
  const goalConfig = getAnalysisGoalConfig(state.analysisGoal);
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
    analysisGoal: {
      id: state.analysisGoal,
      label: goalConfig.label,
      question: goalConfig.question,
      interpretation: goalConfig.interpretation,
      reliabilityOrder: goalConfig.reliabilityOrder,
    },
    audio: {
      a: buildAudioMeta(state.audioA),
      b: buildAudioMeta(state.audioB),
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

function getAnalysisGoalConfig(goalId) {
  const goals = {
    'sound-mirror': {
      label: 'Sound mirror (phonetic similarity)',
      question: 'Hai audio có giống nhau về chuỗi âm thanh phonetic — bất kể ngôn ngữ, giọng hay nghĩa không?',
      description: 'AI sẽ ưu tiên MFCC-39 + DTW, LPC, nhịp voiced/unvoiced và spectral flux để đánh giá độ giống nhau về hình dạng âm phonetic, không phân biệt ngôn ngữ hay người nói.',
      interpretation: 'Tập trung vào hình dạng âm vị học: cấu hình vocal tract, chuyển tiếp phụ âm, nhịp âm tiết. "I\'ll go there" và "úm um ùm" có thể có điểm cao nếu chuỗi âm phonetic trùng khớp.',
      reliabilityOrder: ['mfcc', 'lpc', 'vuv', 'sflux', 'melspec'],
    },
    'same-speaker': {
      label: 'Voice similarity / possible same speaker',
      question: 'Hai audio có đủ giống nhau về giọng/âm sắc để nghi là cùng giọng hoặc rất giống giọng không?',
      description: 'AI sẽ ưu tiên MFCC + DTW và phổ giọng để trả lời: hai clip có đủ giống nhau về giọng/âm sắc hay không.',
      interpretation: 'Tập trung vào timbre, spectral envelope, formant support, pitch chỉ là phụ. Không xác minh danh tính.',
      reliabilityOrder: ['mfcc', 'melspec', 'formant', 'pitch', 'rawcorr'],
    },
    pronunciation: {
      label: 'Pronunciation / same phrase similarity',
      question: 'Hai audio có giống cách phát âm, nhịp đọc hoặc cùng nội dung/câu nói không?',
      description: 'AI sẽ ưu tiên MFCC + DTW, formant và pitch contour để đánh giá cách phát âm/nhịp đọc, không mặc định là cùng người nói.',
      interpretation: 'Tập trung vào cách phát âm, nguyên âm, cao độ và căn chỉnh thời gian; khác speaker vẫn có thể similar một phần.',
      reliabilityOrder: ['mfcc', 'formant', 'pitch', 'melspec', 'rawcorr'],
    },
    'overall-sound': {
      label: 'Overall acoustic similarity',
      question: 'Hai audio có giống âm thanh tổng thể, texture, năng lượng và phổ không?',
      description: 'AI sẽ cân bằng Mel spectrogram, MFCC và raw correlation để nhận xét độ giống âm thanh tổng thể/texture.',
      interpretation: 'Tập trung vào cảm giác âm thanh tổng quát; không suy luận người nói hoặc nội dung.',
      reliabilityOrder: ['melspec', 'mfcc', 'rawcorr', 'pitch', 'formant'],
    },
    'custom-review': {
      label: 'Technical result review',
      question: 'Kết quả kỹ thuật đang nói gì và có rủi ro diễn giải sai ở đâu?',
      description: 'AI sẽ đọc kỹ thuật, chỉ ra method đáng tin/yếu, cảnh báo dữ liệu kém và không ép kết luận giống/khác.',
      interpretation: 'Tập trung kiểm định chất lượng kết quả, mâu thuẫn giữa method và bước debug tiếp theo.',
      reliabilityOrder: ['mfcc', 'melspec', 'formant', 'pitch', 'rawcorr'],
    },
  };
  return goals[goalId] || goals['same-speaker'];
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
