import { makeKeyer, parseRows, toCsv, appendRow } from '../leetcode/trackerCsv';
import { groupByProblem, overallStats, weekProgress, targetNumber, earliestDate } from './stats';

const r = o => ({
  date: '2026-09-08',
  lc: '1',
  name: 'P',
  status: 'Solved',
  difficulty: 'Easy',
  pattern: 'Two Pointers',
  ...o,
});

describe('groupByProblem / overallStats', () => {
  const rows = [
    r({ lc: '1', date: '2026-09-01', status: 'Failed' }),
    r({ lc: '1', date: '2026-09-04', status: 'Solved' }),
    r({ lc: '2', date: '2026-09-02', status: 'Failed', difficulty: 'Hard', pattern: 'BFS' }),
    r({ lc: '3', date: '2026-09-03', difficulty: 'Medium', pattern: '' }),
  ];
  const groups = groupByProblem(rows, makeKeyer(rows));

  test('groups attempts per problem, tracks first date and latest attempt', () => {
    expect(groups.size).toBe(3);
    const g = groups.get('lc:1');
    expect([g.rows.length, g.first, g.latest.status, g.everSolved]).toEqual([2, '2026-09-01', 'Solved', true]);
  });
  test('"solved" means ever solved; unspecified patterns are bucketed', () => {
    const s = overallStats(groups);
    expect([s.problems, s.solved, s.attempts]).toEqual([3, 2, 4]);
    expect(s.byDifficulty).toEqual({ Easy: 1, Medium: 1 });
    expect(s.byPattern).toEqual({ 'Two Pointers': 1, Unspecified: 1 });
  });
});

describe('weekProgress', () => {
  const rows = [
    r({ lc: '1', date: '2026-09-08' }), // week 1, first attempt -> new
    r({ lc: '2', date: '2026-09-09' }), // week 1, new
    r({ lc: '1', date: '2026-09-10' }), // week 1, later attempt -> review
    r({ lc: '3', date: '2026-09-16' }), // week 2, new
  ];
  const groups = groupByProblem(rows, makeKeyer(rows));
  test('first attempts are new, later attempts are reviews', () => {
    expect(weekProgress(groups, 1, '2026-09-08')).toEqual({ newCount: 2, reviewCount: 1 });
    expect(weekProgress(groups, 2, '2026-09-08')).toEqual({ newCount: 1, reviewCount: 0 });
  });
  test('a review in a later week than its first attempt counts as review there', () => {
    const later = [r({ lc: '1', date: '2026-09-08' }), r({ lc: '1', date: '2026-09-17' })];
    const g = groupByProblem(later, makeKeyer(later));
    expect(weekProgress(g, 2, '2026-09-08')).toEqual({ newCount: 0, reviewCount: 1 });
  });
});

describe('helpers', () => {
  test('targetNumber reads plan targets like "~3"', () => {
    expect([targetNumber('23'), targetNumber('~3'), targetNumber('0'), targetNumber('')]).toEqual([23, 3, 0, null]);
  });
  test('earliestDate ignores blanks', () => {
    expect(earliestDate([r({ date: '' }), r({ date: '2026-09-05' }), r({ date: '2026-09-01' })])).toBe('2026-09-01');
  });
  test('toCsv round-trips through parseRows and matches appendRow output', () => {
    const rows = [r({ notes: 'a, "b"\nc', url: 'https://leetcode.com/problems/x/' }), r({ lc: '2' })];
    expect(parseRows(toCsv(rows)).map(x => x.notes)).toEqual([rows[0].notes, undefined].map(v => v || ''));
    expect(toCsv([rows[0]])).toBe(appendRow(null, rows[0]));
  });
});
