/**
 * dtw.js — Dynamic Time Warping algorithm
 */

/**
 * Compute DTW distance between two sequences of feature vectors.
 * @param {Array<Float64Array>} seqA - sequence A (frames × features)
 * @param {Array<Float64Array>} seqB - sequence B (frames × features)
 * @returns {{ distance: number, path: Array<[number,number]>, matrix: Float64Array }} DTW result
 */
export function dtw(seqA, seqB) {
  const N = seqA.length;
  const M = seqB.length;

  if (N === 0 || M === 0) {
    return { distance: Infinity, path: [], matrix: new Float64Array(0) };
  }

  // Allocate cost matrix (flattened row-major)
  const cost = new Float64Array(N * M);
  const INF = 1e18;

  // Fill cost matrix
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const d = euclidean(seqA[i], seqB[j]);
      let prev;
      if (i === 0 && j === 0) {
        prev = 0;
      } else if (i === 0) {
        prev = cost[j - 1];
      } else if (j === 0) {
        prev = cost[(i - 1) * M];
      } else {
        prev = Math.min(
          cost[(i - 1) * M + (j - 1)],
          cost[(i - 1) * M + j],
          cost[i * M + (j - 1)]
        );
      }
      cost[i * M + j] = d + prev;
    }
  }

  // Traceback
  const path = [];
  let i = N - 1;
  let j = M - 1;
  path.push([i, j]);

  while (i > 0 || j > 0) {
    if (i === 0) {
      j--;
    } else if (j === 0) {
      i--;
    } else {
      const diag = cost[(i - 1) * M + (j - 1)];
      const up = cost[(i - 1) * M + j];
      const left = cost[i * M + (j - 1)];
      const minVal = Math.min(diag, up, left);
      if (minVal === diag) {
        i--;
        j--;
      } else if (minVal === up) {
        i--;
      } else {
        j--;
      }
    }
    path.push([i, j]);
  }
  path.reverse();

  const totalCost = cost[N * M - 1];
  const normalizedDistance = totalCost / path.length;

  return {
    distance: normalizedDistance,
    path,
    matrix: cost,
    rows: N,
    cols: M,
  };
}

/**
 * Euclidean distance between two feature vectors.
 */
export function euclidean(a, b) {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Map DTW distance to percentage similarity.
 * sim = 100 * exp(-distance / scale)
 */
export function distanceToSimilarity(distance, scale = 2.0) {
  if (!isFinite(distance)) return 0;
  return 100 * Math.exp(-distance / scale);
}

/**
 * DTW on scalar sequences (1D, e.g. pitch, single formant).
 * Wraps each scalar in a Float64Array for use with dtw().
 */
export function dtwScalar(seqA, seqB) {
  const wrappedA = Array.from(seqA, v => new Float64Array([v]));
  const wrappedB = Array.from(seqB, v => new Float64Array([v]));
  return dtw(wrappedA, wrappedB);
}

/**
 * DTW on 2D sequences (e.g. F1+F2 formant pairs).
 */
export function dtw2D(seqA1, seqA2, seqB1, seqB2) {
  const lenA = Math.min(seqA1.length, seqA2.length);
  const lenB = Math.min(seqB1.length, seqB2.length);
  const wrappedA = Array.from({ length: lenA }, (_, i) => new Float64Array([seqA1[i], seqA2[i]]));
  const wrappedB = Array.from({ length: lenB }, (_, i) => new Float64Array([seqB1[i], seqB2[i]]));
  return dtw(wrappedA, wrappedB);
}
