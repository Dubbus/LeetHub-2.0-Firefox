import { makeKeyer } from '../leetcode/trackerCsv';
import { progressReport } from './export';

const r = o => ({
  date: '2026-09-08',
  lc: '1',
  name: 'Two Sum',
  status: 'Solved',
  difficulty: 'Easy',
  pattern: 'Arrays & Hashing',
  attemptType: 'Cold',
  hint: 'N',
  box: '1',
  ...o,
});

const report = rows =>
  progressReport({
    rows,
    today: '2026-09-10',
    planStart: '2026-09-07',
    keyOf: makeKeyer(rows),
    settings: { sessionSize: 5, advancePct: 80, focusOverride: '' },
    problems: [],
    generatedAt: new Date('2026-09-10T12:00:00Z'),
  });

describe('progressReport', () => {
  test('works with no attempts', () => {
    const text = report([]);
    expect(text).toContain('GRITHUB INTERVIEW PREP');
    expect(text).toContain('Attempts logged: 0');
    expect(text).toContain('No attempts yet.');
  });

  test('summarises attempts, patterns, reviews and the log', () => {
    const text = report([
      r({
        date: '2026-09-07',
        status: 'Failed',
        hint: 'Y',
        totalMin: '30',
        bugs: 'off by one',
        box: '1',
      }),
      r({ date: '2026-09-09', totalMin: '10', quality: '4', notes: 'use a hash map', box: '2' }),
      r({
        lc: '2',
        name: 'Add Two Numbers',
        pattern: 'Linked List',
        difficulty: 'Medium',
        bugs: 'None',
        box: '1',
      }),
    ]);
    expect(text).toContain('Problems attempted: 2 | Solved at least once: 2 | Attempts logged: 3');
    expect(text).toMatch(
      /- Arrays & Hashing: 1 problems \| 2 attempts \| solved 50% \| hint needed 50% .*avg total 20 min/
    );
    expect(text).toContain('- #2 Add Two Numbers (box 1, due 2026-09-10)');
    expect(text).toContain('Mistakes: off by one');
    expect(text).toContain('Notes: use a hash map');
    expect(text).not.toContain('Mistakes: None');
    expect(text.indexOf('* 2026-09-07')).toBeLessThan(text.indexOf('* 2026-09-09'));
  });
});
