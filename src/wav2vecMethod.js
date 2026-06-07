const MODEL_ID = 'Xenova/wav2vec2-base';

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
        progress_callback: () => notifyListeners(),
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
  const output = await extractor(samples, { pooling: 'mean', normalize: true });
  return output.data;
}

export async function runWav2VecSimilarity(samplesA, samplesB) {
  if (modelState !== 'ready') await loadModel();
  if (modelState !== 'ready') {
    return { score: 0, label: `Model error: ${modelError}`, data: {} };
  }
  const [embA, embB] = await Promise.all([embedSamples(samplesA), embedSamples(samplesB)]);
  const sim = cosineSimilarity(embA, embB);
  const score = Math.round(((sim + 1) / 2) * 100);
  return {
    score,
    label: score >= 80 ? 'Very similar' : score >= 60 ? 'Quite similar' : score >= 40 ? 'Somewhat similar' : 'Different',
    data: { cosineSim: sim },
  };
}

export { loadModel };
