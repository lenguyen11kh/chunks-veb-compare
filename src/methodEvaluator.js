const VERDICT_RANKS = {
  'very-similar': 4,
  'similar': 3,
  'different': 2,
  'very-different': 1,
};

export function verdictToRank(verdict) {
  return VERDICT_RANKS[verdict] ?? null;
}

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
