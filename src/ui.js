/**
 * ui.js — DOM helpers, score cards, comparison table, radar chart
 */

import { METHOD_DEFS } from './methods.js';

// ---------------------------------------------------------------------------
// Score card rendering
// ---------------------------------------------------------------------------

/**
 * @param {{ score: number, label: string }} result
 * @param {{ id: string, name: string }} method
 */
export function createScoreCard(result, method) {
  const card = document.createElement('div');
  card.className = 'score-card';

  const scoreVal = Math.round(result.score);
  const colorClass = scoreColorClass(scoreVal);

  card.innerHTML = `
    <div class="score-method-label">${method.id} — ${method.name}</div>
    <div class="score-value ${colorClass}">${scoreVal}<span class="score-pct">%</span></div>
    <div class="score-similarity-label ${colorClass}">${result.label}</div>
  `;
  return card;
}

function scoreColorClass(score) {
  if (score >= 80) return 'score-high';
  if (score >= 60) return 'score-medium';
  if (score >= 40) return 'score-low';
  return 'score-poor';
}

// ---------------------------------------------------------------------------
// Comparison table
// ---------------------------------------------------------------------------

/**
 * Build a table comparing all method scores.
 * @param {Array<{ method: object, result: object }>} entries
 */
export function createComparisonTable(entries) {
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrapper';

  const title = document.createElement('h3');
  title.textContent = 'Method comparison';
  wrapper.appendChild(title);

  const table = document.createElement('table');
  table.className = 'comparison-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Method</th>
        <th>Score</th>
        <th>Assessment</th>
        <th>Bar</th>
      </tr>
    </thead>
    <tbody>
      ${entries.map(({ method, result }) => {
        const score = Math.round(result.score);
        const colorClass = scoreColorClass(score);
        return `
          <tr>
            <td><span class="method-badge">${method.id.toUpperCase()}</span> ${method.name}</td>
            <td class="${colorClass} score-cell">${score}%</td>
            <td>${result.label}</td>
            <td>
              <div class="bar-container">
                <div class="bar-fill ${colorClass}" style="width:${score}%"></div>
              </div>
            </td>
          </tr>
        `;
      }).join('')}
    </tbody>
  `;
  wrapper.appendChild(table);
  return wrapper;
}

// ---------------------------------------------------------------------------
// Radar chart (Chart.js)
// ---------------------------------------------------------------------------

let radarChartInstance = null;

/**
 * Render or update the radar chart.
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{ method: object, result: object }>} entries
 */
export function renderRadarChart(canvas, entries) {
  if (radarChartInstance) {
    radarChartInstance.destroy();
    radarChartInstance = null;
  }

  const labels = entries.map(e => e.method.name);
  const data = entries.map(e => Math.round(e.result.score));

  radarChartInstance = new Chart(canvas, {
    type: 'radar',
    data: {
      labels,
      datasets: [
        {
          label: 'Similarity %',
          data,
          backgroundColor: 'rgba(99,102,241,0.18)',
          borderColor: 'rgba(99,102,241,0.85)',
          pointBackgroundColor: 'rgba(99,102,241,1)',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: 'rgba(99,102,241,1)',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: {
            stepSize: 20,
            color: '#6b7280',
            font: { size: 11 },
          },
          grid: { color: 'rgba(107,114,128,0.2)' },
          pointLabels: {
            font: { size: 12, weight: '600' },
            color: '#374151',
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.raw}%`,
          },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Method toggle cards
// ---------------------------------------------------------------------------

/**
 * Render method toggle cards into a container element.
 * @param {HTMLElement} container
 * @param {Set<string>} enabledIds - currently-enabled method IDs
 * @param {(id: string, enabled: boolean) => void} onChange
 */
export function renderMethodCards(container, enabledIds, onChange) {
  const methodTooltips = {
    mfcc: 'So sánh âm sắc và bao phổ theo thời gian, sau đó dùng DTW để căn chỉnh hai clip dù một clip nói nhanh/chậm hơn clip còn lại.',
    formant: 'Theo dõi F1/F2 — cộng hưởng nguyên âm. Hữu ích khi kiểm tra chất lượng nguyên âm và hình dạng phát âm của các đoạn hữu thanh.',
    melspec: 'So sánh mẫu năng lượng trên các dải tần Mel. Phù hợp để xem texture/phổ tổng thể, nhưng ít linh hoạt về thời gian hơn DTW.',
    pitch: 'So sánh đường cao độ F0 theo thời gian. Hữu ích cho ngữ điệu, giai điệu hoặc thanh điệu; không đại diện toàn bộ phát âm.',
    rawcorr: 'So sánh trực tiếp dạng sóng thô làm baseline. Rất nhanh nhưng nhạy với timing, speaker, pha và điều kiện ghi âm.',
  };

  container.innerHTML = '';
  for (const method of METHOD_DEFS) {
    const isEnabled = enabledIds.has(method.id);
    const card = document.createElement('div');
    card.className = 'method-card' + (isEnabled ? ' method-card--active' : '');
    card.dataset.id = method.id;

    const switchId = `method-switch-${method.id}`;
    card.innerHTML = `
      <div class="method-card-info">
        <span class="method-card-id">${method.id.toUpperCase()}</span>
        <div>
          <div class="method-card-name">${method.name} <span class="tooltip-dot" tabindex="0" aria-label="Giải thích ${method.name}" data-tooltip="${methodTooltips[method.id] || method.subtitle}">?</span></div>
          <div class="method-card-desc">${method.subtitle}</div>
        </div>
      </div>
      <label class="toggle-switch" for="${switchId}" title="Enable ${method.name}">
        <input type="checkbox" id="${switchId}" ${isEnabled ? 'checked' : ''}>
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    `;

    const checkbox = card.querySelector('input[type=checkbox]');
    checkbox.addEventListener('change', () => {
      card.classList.toggle('method-card--active', checkbox.checked);
      onChange(method.id, checkbox.checked);
    });

    container.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Audio slot UI helpers
// ---------------------------------------------------------------------------

export function setSlotLoading(slotEl, loading) {
  slotEl.classList.toggle('slot--loading', loading);
}

export function setSlotInfo(slotEl, info) {
  const el = slotEl.querySelector('.slot-info');
  if (el) el.textContent = info;
}

export function setSlotHasAudio(slotEl, hasAudio) {
  slotEl.classList.toggle('slot--has-audio', hasAudio);
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ---------------------------------------------------------------------------
// Export JSON
// ---------------------------------------------------------------------------

export function exportResultsToJSON(results, audioMeta) {
  const payload = {
    exportedAt: new Date().toISOString(),
    audioA: audioMeta.a,
    audioB: audioMeta.b,
    results: results.map(({ method, result }) => ({
      methodId: method.id,
      methodName: method.name,
      score: Math.round(result.score * 100) / 100,
      label: result.label,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audio-similarity-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Verdict strip
// ---------------------------------------------------------------------------

const VERDICT_OPTIONS = [
  { value: 'very-similar', label: 'Very Similar' },
  { value: 'similar', label: 'Similar' },
  { value: 'different', label: 'Different' },
  { value: 'very-different', label: 'Very Different' },
];

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
