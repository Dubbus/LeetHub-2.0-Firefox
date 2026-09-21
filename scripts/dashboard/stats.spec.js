import { makeKeyer, parseRows, toCsv, appendRow } from '../leetcode/trackerCsv';
import {
  groupByProblem,
  overallStats,
  weekProgress,
  targetNumber,
  earliestDate,
  parsePct,
  planProgress,
  focusWeek,
  patternProgress,
  nextNew,
  sessionMix,
} from './stats';

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

describe('plan position (progress-based, not calendar-based)', () => {
  const url = slug => `https://leetcode.com/problems/${slug}/`;
  const PLAN = [
    { week: 1, pattern: 'Two Pointers', name: 'Valid Palindrome', url: url('valid-palindrome') },
    { week: 1, pattern: 'Two Pointers', name: '3Sum', url: url('3sum') },
    { week: 1, pattern: 'Sliding Window', name: 'Longest Substring', url: url('longest-substring') },
    { week: 1, pattern: 'Sliding Window', name: 'Min Window', url: url('min-window') },
    { week: 1, pattern: 'Arrays & Hashing', name: 'Two Sum', url: url('two-sum') },
    { week: 2, pattern: 'Binary Search', name: 'Binary Search', url: url('binary-search') },
    { week: 2, pattern: 'Binary Search', name: 'Search Insert', url: url('search-insert') },
    { week: 3, pattern: 'Mixed', name: 'free-text note', url: '' },
  ];
  const attempt = (slug, status = 'Solved') => r({ lc: slug, url: url(slug), name: slug, status });
  const build = rows => {
    const keyOf = makeKeyer(rows, PLAN);
    return planProgress(PLAN, groupByProblem(rows, keyOf), keyOf);
  };

  test('counts solved problems per plan week; weeks with only notes have ratio 1', () => {
    const weeks = build([attempt('valid-palindrome'), attempt('3sum', 'Failed')]);
    expect(weeks.map(w => [w.week, w.solved, w.total])).toEqual([[1, 1, 5], [2, 0, 2], [3, 0, 0]]);
    expect(weeks[2].ratio).toBe(1);
  });
  test('being behind keeps you on week 1 until it is mostly done, whatever the calendar says', () => {
    const early = build([attempt('valid-palindrome'), attempt('3sum')]);
    expect(focusWeek(early, 0.8, null)).toBe(1);
    const threeOfFive = build(['valid-palindrome', '3sum', 'longest-substring'].map(s => attempt(s)));
    expect(focusWeek(threeOfFive, 0.8, null)).toBe(1); // 60% is still below 80%
  });
  test('week 1 advances at the threshold; manual override wins; finishing everything returns null', () => {
    const four = build(['valid-palindrome', '3sum', 'longest-substring', 'min-window'].map(s => attempt(s)));
    expect(focusWeek(four, 0.8, null)).toBe(2);
    expect(focusWeek(four, 0.8, '1')).toBe(1);
    const all = build(['valid-palindrome', '3sum', 'longest-substring', 'min-window', 'two-sum', 'binary-search', 'search-insert'].map(s => attempt(s)));
    expect(focusWeek(all, 0.8, null)).toBe(null);
  });
  test('pattern progress inside a week', () => {
    const week = build([attempt('valid-palindrome'), attempt('longest-substring')])[0];
    expect(patternProgress(week)).toEqual([
      { pattern: 'Two Pointers', solved: 1, total: 2 },
      { pattern: 'Sliding Window', solved: 1, total: 2 },
      { pattern: 'Arrays & Hashing', solved: 0, total: 1 },
    ]);
  });
  test('next new: focus week in list order, then earlier leftovers, then later weeks', () => {
    const weeks = build([attempt('valid-palindrome'), attempt('3sum'), attempt('min-window')]);
    const names = (focus, n, pat) => nextNew(weeks, focus, n, pat).map(i => i.problem.name);
    expect(names(1, 3)).toEqual(['Longest Substring', 'Two Sum', 'Binary Search']);
    expect(names(2, 3)).toEqual(['Binary Search', 'Search Insert', 'Longest Substring']);
  });
  test('attempted-but-unsolved problems are not offered as new (they return through review)', () => {
    const weeks = build([attempt('valid-palindrome', 'Failed'), attempt('3sum', 'Partial')]);
    expect(nextNew(weeks, 1, 5).map(i => i.problem.name)).toEqual(['Longest Substring', 'Min Window', 'Two Sum', 'Binary Search', 'Search Insert']);
  });
  test('choosing a pattern pulls its problems first', () => {
    const weeks = build([]);
    expect(nextNew(weeks, 1, 3, 'Sliding Window').map(i => i.problem.name)).toEqual(['Longest Substring', 'Min Window', 'Valid Palindrome']);
    expect(nextNew(weeks, 1, 2, '').map(i => i.week)).toEqual([1, 1]);
  });
});

describe('sessionMix / parsePct', () => {
  test('percentages', () => {
    expect([parsePct('85%'), parsePct('~15%'), parsePct('0%'), parsePct('')]).toEqual([0.85, 0.15, 0, 0]);
  });
  test('week 1 (0% review): one review slot at most, the rest new', () => {
    expect(sessionMix(5, 0, 6)).toEqual({ reviews: 1, news: 4 });
  });
  test('no due reviews means an all-new session', () => {
    expect(sessionMix(5, 0.55, 0)).toEqual({ reviews: 0, news: 5 });
  });
  test('late weeks lean on review but are capped by what is due', () => {
    expect(sessionMix(5, 0.55, 10)).toEqual({ reviews: 3, news: 2 });
    expect(sessionMix(5, 0.55, 2)).toEqual({ reviews: 2, news: 3 });
  });
  test('reviews can never crowd out everything unless the session is only reviews', () => {
    expect(sessionMix(3, 0.55, 99).news).toBe(1);
  });
});
