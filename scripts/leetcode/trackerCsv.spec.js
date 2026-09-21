import {
  COLUMNS,
  appendRow,
  parseCsv,
  parseRows,
  guessPattern,
  suggestBox,
  nextReview,
  dueReviews,
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
