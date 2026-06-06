import { describe, it, expect } from 'vitest';
import { verdictToRank, computeMethodPerformance } from '../src/methodEvaluator.js';

describe('verdictToRank', () => {
  it('maps all four verdict values to ranks 1-4', () => {
    expect(verdictToRank('very-similar')).toBe(4);
    expect(verdictToRank('similar')).toBe(3);
    expect(verdictToRank('different')).toBe(2);
    expect(verdictToRank('very-different')).toBe(1);
  });

  it('maps unreviewed to null', () => {
    expect(verdictToRank('unreviewed')).toBe(null);
  });

  it('maps unknown values to null', () => {
    expect(verdictToRank('anything-else')).toBe(null);
  });
});

function makeEntry(methodId, score, verdict) {
  return {
    summary: { methods: [{ id: methodId, score }] },
    review: { humanVerdict: verdict },
  };
}

describe('computeMethodPerformance', () => {
  it('returns empty array when fewer than 5 labeled entries', () => {
    const entries = [
      makeEntry('mfcc', 90, 'very-similar'),
      makeEntry('mfcc', 80, 'similar'),
    ];
    expect(computeMethodPerformance(entries)).toEqual([]);
  });

  it('returns empty array when all entries are unreviewed', () => {
    const entries = Array.from({ length: 10 }, () => makeEntry('mfcc', 70, 'unreviewed'));
    expect(computeMethodPerformance(entries)).toEqual([]);
  });

  it('returns correlation of 1.0 for perfectly rank-ordered scores', () => {
    const entries = [
      makeEntry('mfcc', 100, 'very-similar'),
      makeEntry('mfcc', 75, 'similar'),
      makeEntry('mfcc', 50, 'different'),
      makeEntry('mfcc', 25, 'very-different'),
      makeEntry('mfcc', 10, 'very-different'),
    ];
    const results = computeMethodPerformance(entries);
    expect(results.length).toBe(1);
    expect(results[0].methodId).toBe('mfcc');
    expect(results[0].correlation).toBeGreaterThan(0.95);
    expect(results[0].sampleSize).toBe(5);
  });

  it('returns correlation near -1.0 for inverted scores', () => {
    const entries = [
      makeEntry('mfcc', 10, 'very-similar'),
      makeEntry('mfcc', 25, 'similar'),
      makeEntry('mfcc', 75, 'different'),
      makeEntry('mfcc', 90, 'very-different'),
      makeEntry('mfcc', 100, 'very-different'),
    ];
    const results = computeMethodPerformance(entries);
    expect(results[0].correlation).toBeLessThan(-0.8);
  });

  it('excludes unreviewed entries from correlation', () => {
    const entries = [
      makeEntry('mfcc', 100, 'very-similar'),
      makeEntry('mfcc', 75, 'similar'),
      makeEntry('mfcc', 50, 'different'),
      makeEntry('mfcc', 25, 'very-different'),
      makeEntry('mfcc', 10, 'very-different'),
      makeEntry('mfcc', 99, 'unreviewed'), // should be ignored
    ];
    const results = computeMethodPerformance(entries);
    expect(results[0].sampleSize).toBe(5); // not 6
  });

  it('sorts results by correlation descending', () => {
    const entries = [
      { summary: { methods: [{ id: 'good', score: 100 }, { id: 'bad', score: 10 }] }, review: { humanVerdict: 'very-similar' } },
      { summary: { methods: [{ id: 'good', score: 75 }, { id: 'bad', score: 90 }] }, review: { humanVerdict: 'similar' } },
      { summary: { methods: [{ id: 'good', score: 50 }, { id: 'bad', score: 60 }] }, review: { humanVerdict: 'different' } },
      { summary: { methods: [{ id: 'good', score: 25 }, { id: 'bad', score: 80 }] }, review: { humanVerdict: 'very-different' } },
      { summary: { methods: [{ id: 'good', score: 10 }, { id: 'bad', score: 95 }] }, review: { humanVerdict: 'very-different' } },
    ];
    const results = computeMethodPerformance(entries);
    expect(results[0].methodId).toBe('good');
    expect(results[1].methodId).toBe('bad');
    expect(results[0].correlation).toBeGreaterThan(results[1].correlation);
  });
});
