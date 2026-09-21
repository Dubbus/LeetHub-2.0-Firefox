#!/usr/bin/env python3
"""
One-off dev tool (not shipped): extracts the static reference tabs of interview_prep_tracker.xlsx
into JSON for the dashboard. Standard library only.

    python3 tools/extract-workbook.py ~/Downloads/interview_prep_tracker.xlsx scripts/dashboard/data

Tab layouts are hard-coded below; if the workbook layout changes, adjust the row ranges.
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
PERSONAL_SUFFIX = re.compile(r'\s+—\s+\w+$')  # "8-Week Interview Prep Tracker — Adarsh"


def load(path):
    z = zipfile.ZipFile(path)
    strings = [
        ''.join(t.text or '' for t in si.iter('{%s}t' % NS['m']))
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)
    ]
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    names = [s.get('name') for s in wb.find('m:sheets', NS)]
    return z, strings, names


def read_sheet(z, strings, index):
    """-> ({row: {col_letter: value}}, {cell_ref: hyperlink_url})"""
    root = ET.fromstring(z.read(f'xl/worksheets/sheet{index}.xml'))
    rows = {}
    for row in root.findall('.//m:row', NS):
        cells = {}
        for c in row.findall('m:c', NS):
            v = c.find('m:v', NS)
            if v is None:
                continue
            value = strings[int(v.text)] if c.get('t') == 's' else v.text
            if value is None:
                continue
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            cells[col] = value.strip()
        rows[int(row.get('r'))] = cells

    links = {}
    try:
        rels = {
            r.get('Id'): r.get('Target')
            for r in ET.fromstring(z.read(f'xl/worksheets/_rels/sheet{index}.xml.rels'))
        }
        for h in root.findall('.//m:hyperlink', NS):
            target = rels.get(h.get('{%s}id' % NS['r']))
            if target:
                links[h.get('ref')] = target
    except KeyError:
        pass
    return rows, links


def num(s):
    return int(s) if s and s.isdigit() else s


def main(xlsx, out_dir):
    z, strings, names = load(xlsx)
    sheet = {n: read_sheet(z, strings, i) for i, n in enumerate(names, 1)}

    def write(name, data):
        with open(f'{out_dir}/{name}.json', 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        size = len(data) if isinstance(data, list) else len(data.keys())
        print(f'{name}.json: {size} entries')

    # Overview: title, subtitle and "Core rules" only (the how-to list is spreadsheet-specific).
    rows, _ = sheet['Overview']
    rules = [
        {'label': r['A'], 'text': r['B']}
        for n, r in sorted(rows.items())
        if n >= 13 and 'A' in r and 'B' in r
    ]
    write('overview', {
        'title': PERSONAL_SUFFIX.sub('', rows[1]['A']),
        'subtitle': rows[2]['A'],
        'rules': rules,
    })

    rows, _ = sheet['8-Week Plan']
    write('plan', [
        {
            'week': int(r['A']), 'phase': r['B'], 'patterns': r['C'], 'newTarget': r['D'],
            'reviewTarget': r['E'], 'hours': r['F'], 'companyPct': r['G'], 'notes': r.get('H', ''),
        }
        for n, r in sorted(rows.items()) if n >= 2 and r.get('A', '').isdigit()
    ])

    rows, links = sheet['Problem List (by Week)']
    problems = []
    for n, r in sorted(rows.items()):
        if n >= 5 and r.get('A', '').isdigit() and 'C' in r:
            problems.append({
                'week': int(r['A']), 'pattern': r['B'], 'name': r['C'], 'difficulty': r['D'],
                'url': links.get(f'E{n}', ''), 'notes': r.get('F', ''),
            })
    write('problems', problems)

    rows, _ = sheet['Pattern Cheatsheet']
    write('cheatsheet', [
        {'pattern': r['A'], 'framework': r['B'], 'signal': r['C'], 'backup': r.get('D', '')}
        for n, r in sorted(rows.items()) if n >= 2 and 'A' in r
    ])

    rows, _ = sheet['Review Weighting Guide']
    write('guide', {
        'mix': [
            {'week': int(r['A']), 'new': r['B'], 'review': r['C'], 'company': r['D'], 'rationale': r.get('E', '')}
            for n, r in sorted(rows.items()) if 4 <= n <= 11 and r.get('A', '').isdigit()
        ],
        'leitner': [
            {'box': int(r['A']), 'meaning': r['B'], 'days': int(r['C'])}
            for n, r in sorted(rows.items()) if 16 <= n <= 20
        ],
        'rule': rows[22]['B'],
    })

    rows, _ = sheet['Company Repo Usage (Optional)']
    write('company', {
        'title': rows[1]['A'],
        'intro': rows[2]['A'],
        'rows': [
            {'when': r['A'], 'how': r['B'], 'companies': r['C'], 'budget': r['D']}
            for n, r in sorted(rows.items()) if n >= 5 and 'A' in r
        ],
    })


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
