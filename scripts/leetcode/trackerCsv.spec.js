import {
  COLUMNS,
  appendRow,
  parseCsv,
  parseRows,
  guessPattern,
  suggestBox,
  nextReview,
  dueReviews,
  reviewSchedule,
  makeKeyer,
  normalizeDate,
  weekOf,
  studyDay,
  splitQueue,
  annotateAttempts,
  importRows,
} from './trackerCsv';

const row = overrides => ({
  date: '2026-09-08',
  lc: '3',
  name: 'Longest Substring Without Repeating Characters',
  status: 'Solved',
  hint: 'N',
  attemptType: 'Cold',
  box: '2',
  ...overrides,
});

describe('CSV', () => {
  test('creates the header when the file is new', () => {
    const out = appendRow(null, row());
    const [header, line] = out.split('\n');
    expect(header.split(',')).toHaveLength(COLUMNS.length);
    expect(header.startsWith('Date Solved,LC #,Problem Name,Pattern')).toBe(true);
    expect(line.startsWith('2026-09-08,3,Longest Substring')).toBe(true);
  });

  test('appends to an existing file, with or without a trailing newline', () => {
    const first = appendRow(null, row({ lc: '1' }));
    const second = appendRow(first, row({ lc: '2' }));
    const third = appendRow(second.trimEnd(), row({ lc: '3' }));
    expect(parseRows(third).map(r => r.lc)).toEqual(['1', '2', '3']);
  });

  test('round-trips commas, quotes and newlines in free text', () => {
    const notes = 'Two pointers, "shrink" left\nthen check, again';
    const out = appendRow(null, row({ notes, bugs: 'off-by-one' }));
    const [parsed] = parseRows(out);
    expect(parsed.notes).toBe(notes);
    expect(parsed.bugs).toBe('off-by-one');
  });

  test('parses CRLF files', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('matches columns by header, so reordering is fine', () => {
    const rows = parseRows('LC #,Problem Name\n5,Foo\n');
    expect(rows).toEqual([{ lc: '5', name: 'Foo' }]);
  });
});

describe('guessPattern', () => {
  test('prefers specific tags over generic ones', () => {
    expect(guessPattern(['Hash Table', 'String', 'Sliding Window'])).toBe('Sliding Window');
    expect(guessPattern(['Tree', 'Breadth-First Search'])).toBe('BFS');
  });
  test('returns empty string when nothing maps', () => {
    expect(guessPattern(['Math'])).toBe('');
    expect(guessPattern(undefined)).toBe('');
  });
});

describe('suggestBox', () => {
  const attempt = { status: 'Solved', hint: 'N', attemptType: 'Cold' };
  test('new problem starts in box 1', () => {
    expect(suggestBox([], '3', attempt)).toBe(1);
  });
  test('clean cold re-solve bumps one box, capped at 5', () => {
    expect(suggestBox([row({ box: '2' })], '3', attempt)).toBe(3);
    expect(suggestBox([row({ box: '5' })], '3', attempt)).toBe(5);
  });
  test('fumbled re-solve drops back to box 1', () => {
    expect(suggestBox([row({ box: '4' })], '3', { ...attempt, hint: 'Y' })).toBe(1);
    expect(suggestBox([row({ box: '4' })], '3', { ...attempt, status: 'Failed' })).toBe(1);
  });
  test('uses the latest prior attempt of that problem only', () => {
    const history = [row({ box: '4' }), row({ lc: '9', box: '5' }), row({ box: '1' })];
    expect(suggestBox(history, '3', attempt)).toBe(2);
  });
});

describe('nextReview / dueReviews', () => {
  test('applies the workbook interval table (2/4/8/16/30 days)', () => {
    expect(nextReview('2026-09-08', 1)).toBe('2026-09-10');
    expect(nextReview('2026-09-08', 2)).toBe('2026-09-12');
    expect(nextReview('2026-09-28', 3)).toBe('2026-10-06');
    expect(nextReview('2026-09-08', 5)).toBe('2026-10-08');
  });
  test('returns null for bad input', () => {
    expect(nextReview('', 2)).toBe(null);
    expect(nextReview('2026-09-08', 9)).toBe(null);
  });
  test('lists only due problems, most overdue first, latest attempt per problem', () => {
    const rows = [
      row({ lc: '3', date: '2026-09-01', box: '1' }), // superseded by the later attempt below
      row({ lc: '3', date: '2026-09-15', box: '3' }), // next 2026-09-23, not due on the 20th
      row({ lc: '76', date: '2026-09-10', box: '1' }), // next 09-12, due
      row({ lc: '125', date: '2026-09-18', box: '1' }), // next 09-20, due today
      row({ lc: '200', date: '2026-09-19', box: '2' }), // next 09-23, not due
    ];
    const due = dueReviews(rows, '2026-09-20');
    expect(due.map(d => d.lc)).toEqual(['76', '125']);
  });
});

const PROBLEMS = [
  { name: 'Two Sum II - Input Array Is Sorted', url: 'https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/' },
  { name: 'Valid Palindrome', url: 'https://leetcode.com/problems/valid-palindrome/' },
  { name: 'Valid Palindrome II', url: 'https://leetcode.com/problems/valid-palindrome-ii/' },
];

describe('problem identity', () => {
  test('rows of the same problem share a key across url / lc / name', () => {
    const rows = [
      row({ lc: '167', name: 'Two Sum II - Input Array Is Sorted', url: 'https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/' }),
      row({ lc: '167', name: 'whatever', url: '' }), // learns the slug from the LC # of the row above
      row({ lc: '', name: 'two sum II ', url: '' }), // unique prefix of a known name
    ];
    const keyOf = makeKeyer(rows);
    expect(new Set(rows.map(keyOf)).size).toBe(1);
  });
  test('a prefix shared by several known names is not guessed', () => {
    const keyOf = makeKeyer([], PROBLEMS);
    expect(keyOf({ name: 'valid palindrome', url: '', lc: '' })).toBe('slug:valid-palindrome');
    expect(keyOf({ name: 'valid pal', url: '', lc: '' })).toBe('name:valid pal');
  });
  test('falls back to lc, then name', () => {
    const keyOf = makeKeyer([]);
    expect(keyOf({ lc: '5', name: 'x', url: '' })).toBe('lc:5');
    expect(keyOf({ lc: '', name: '  Foo  Bar ', url: '' })).toBe('name:foo bar');
  });
});

describe('normalizeDate / weekOf', () => {
  test('ISO, US and Excel serial dates', () => {
    expect(normalizeDate('2026-09-08')).toBe('2026-09-08');
    expect(normalizeDate('9/8/2026')).toBe('2026-09-08');
    expect(normalizeDate('46272')).toBe('2026-09-07');
    expect(normalizeDate(46274)).toBe('2026-09-09');
  });
  test('rejects junk', () => {
    expect(normalizeDate('')).toBe('');
    expect(normalizeDate('soon')).toBe('');
    expect(normalizeDate('12')).toBe('');
  });
  test('plan weeks are 1-based, 7 days each', () => {
    expect(weekOf('2026-09-08', '2026-09-08')).toBe(1);
    expect(weekOf('2026-09-14', '2026-09-08')).toBe(1);
    expect(weekOf('2026-09-15', '2026-09-08')).toBe(2);
    expect(weekOf('2026-09-01', '2026-09-08')).toBe(1);
    expect(weekOf('2026-09-15', 'nope')).toBe(null);
  });
});

describe('schedule: the "always DUE" fix', () => {
  const failed = row({ lc: '3', date: '2026-09-01', status: 'Failed', box: '1' });
  const resolved = row({ lc: '3', date: '2026-09-10', status: 'Solved', box: '2' });

  test('an old failed attempt is superseded, not DUE, once the problem is re-solved', () => {
    const annotated = annotateAttempts([failed, resolved], '2026-09-20');
    expect(annotated.map(a => a.flag)).toEqual(['superseded', 'DUE']); // resolved: next 09-14
    expect(dueReviews([failed, resolved], '2026-09-20')).toHaveLength(1);
  });
  test('live rows show the workbook columns: interval, next review, days until due', () => {
    const [a] = annotateAttempts([resolved], '2026-09-12');
    expect([a.interval, a.next, a.daysUntil, a.flag]).toEqual([4, '2026-09-14', 2, '-']);
  });
  test('days until due goes negative when overdue', () => {
    const [a] = annotateAttempts([resolved], '2026-09-20');
    expect([a.daysUntil, a.flag]).toEqual([-6, 'DUE']);
  });
  test('schedule entries carry their key', () => {
    expect(reviewSchedule([resolved])[0].key).toBe('lc:3');
  });
  test('backlog split keeps the most overdue for today', () => {
    const due = [1, 2, 3, 4, 5, 6, 7].map(n => ({ lc: String(n) }));
    const { today, backlog } = splitQueue(due, 5);
    expect([today.length, backlog.length, backlog[0].lc]).toEqual([5, 2, '6']);
  });
});

describe('importRows (workbook Problem Tracker export)', () => {
  const HEADER =
    'Date Solved,LC #,Problem Name,Pattern,Difficulty,Source,Company Tag(s),Attempt Type,Time to First Approach (min),Total Time (min),Needed Framework/Hint?,Solved Status,Approach Quality (1-5),Optimal Complexity?,Bugs / Mistakes Made,Leitner Box (1-5),Interval (days),Next Review Date,Days Until Due,Review Due?,Notes / Takeaway';
  const csv = [
    HEADER,
    '2026-09-08,3,Longest Substring Without Repeating Characters,Sliding Window,Medium,Pattern Drill,,Cold,12,22,N,Solved,4,Y,off-by-one,2,4,2026-09-12,-8,DUE,clean',
    '46274,,two sum II ,Two Pointers,Easy,Pattern Drill,,Warm (read write-up first),15,35,Y,Partial,3,Y,forgot finish,1,2,,,,',
    ',,,,,,,,,,,,,,,,,,,,', // fully empty line: dropped by the CSV parser
    'soon,9,Bad Date Problem,,,,,,,,,,,,,,,,,,', // unusable date
    '2026-09-08,3,Longest Substring Without Repeating Characters,Sliding Window,Medium,Pattern Drill,,Cold,12,22,N,Solved,4,Y,off-by-one,2,,,,,dup',
  ].join('\n');

  test('maps by header, ignores formula columns, normalizes dates, resolves links, skips blank and duplicates', () => {
    const { rows, skipped } = importRows(csv, [], PROBLEMS);
    expect(rows).toHaveLength(2);
    expect(skipped).toEqual({ blank: 1, duplicate: 1 });
    expect(rows[0].box).toBe('2');
    expect(rows[0].notes).toBe('clean');
    expect(rows[1].date).toBe('2026-09-09');
    expect(rows[1].url).toBe('https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/');
    expect('interval' in rows[0]).toBe(false);
  });
  test('does not re-import rows already in the CSV', () => {
    const first = importRows(csv, [], PROBLEMS).rows;
    const again = importRows(csv, first, PROBLEMS);
    expect(again.rows).toHaveLength(0);
    expect(again.skipped.duplicate).toBe(3);
  });
  test('tolerates a UTF-8 BOM', () => {
    expect(importRows('\uFEFF' + csv, [], PROBLEMS).rows).toHaveLength(2);
  });
});

describe('studyDay (late-night mode)', () => {
  const at = (day, hh, mm = 0) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
  test('off: the calendar date', () => {
    expect(studyDay(at('2026-09-23', 1, 30))).toBe('2026-09-23');
    expect(studyDay(at('2026-09-23', 1, 30), 0)).toBe('2026-09-23');
  });
  test('before the day-start hour it is still the previous day', () => {
    expect(studyDay(at('2026-09-23', 1, 30), 4)).toBe('2026-09-22');
    expect(studyDay(at('2026-09-23', 3, 59), 4)).toBe('2026-09-22');
    expect(studyDay(at('2026-03-01', 2), '4')).toBe('2026-02-28');
  });
  test('from the day-start hour on it is today', () => {
    expect(studyDay(at('2026-09-23', 4), 4)).toBe('2026-09-23');
    expect(studyDay(at('2026-09-23', 23, 59), 4)).toBe('2026-09-23');
  });
});
