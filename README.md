<h1 align="center">
  <a href="https://github.com/Dubbus/GritHub"><img src="assets/octocode.png" alt="GritHub - Sync LeetCode solutions to GitHub, with a spaced-repetition interview-prep tracker." width="400"></a>
  <br>
  GritHub
  <br>
  <br>
</h1>

<p align="center">
  Sync your LeetCode/GeeksforGeeks solutions to GitHub automatically, then actually retain them:
  a built-in timer, an interview-prep journal, and a Leitner spaced-repetition dashboard — no spreadsheet required.
</p>

<p align="center">
  <a href="https://github.com/Dubbus/GritHub/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"/>
  </a>
</p>

## Credits

GritHub is a fork of **[LeetHub 2.0 for Firefox](https://github.com/maitreya2954/LeetHub-2.0-Firefox)** by
[Siddharth Rayabharam](https://github.com/maitreya2954) ([listed on addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/leethub-2-0-for-firefox/)),
itself a Firefox port of [LeetHub v2](https://github.com/arunbhardwaj/LeetHub-2.0) by
[arunbhardwaj](https://github.com/arunbhardwaj) and [QasimWani](https://github.com/QasimWani). All the GitHub-sync
functionality — authenticating with GitHub, committing solutions, the repo hookup flow — is their work; this fork
keeps it as-is and adds the interview tracker and dashboard on top.

There's also an existing ecosystem of LeetCode spaced-repetition tools worth knowing about —
[LeetRecur](https://chromewebstore.google.com/detail/leetrecur-spaced-repetiti/lmidmepgdbipmebgdalghmbehpiobiie),
[LeetSpacer](https://github.com/CurtisLuu/LeetSpacer), [SpacedLeet](https://spacedleet.vercel.app/),
[Lanki](https://www.lanki.xyz/) and others solve "review what I've solved" well on their own. GritHub's difference
is folding that into LeetHub's GitHub sync directly, storing everything as a plain CSV in *your own repo* instead
of a database, and pairing it with a structured multi-week curriculum and per-attempt journaling rather than a bare
review queue.

## What GritHub does

A Firefox extension that:
1. **Auto-commits your solution to GitHub** the moment a LeetCode/GeeksforGeeks submission is accepted — this part is unchanged from upstream LeetHub.
2. **Times and logs each attempt** — an initial-approach timer, a solving timer, and a form for pattern, difficulty, mistakes, confidence and notes.
3. **Schedules reviews with a Leitner box** (5 boxes, 2/4/8/16/30-day intervals) so problems resurface before you forget them.
4. **Shows it all in an in-extension dashboard** — no spreadsheet to maintain — with a week-by-week curriculum whose pace follows what you've actually solved, not the calendar.

Everything is stored as `interview_tracker.csv` in your own LeetHub GitHub repo: versioned, diffable, and readable in Excel/Sheets if you'd rather look at it there.

## Why

<p><strong>1.</strong> Recruiters want to see your contributions on GitHub, and pushing every LeetCode solution there manually is tedious. GritHub automates that, same as upstream LeetHub always did.</p>

<p><strong>2.</strong> Solving a problem once doesn't mean you'll still have it cold in an interview three weeks later. Most trackers stop at "mark it done"; GritHub schedules the re-solve and keeps your own notes on what tripped you up last time.</p>

## How it works

1. Install the addon and authenticate with GitHub (via the popup), same as upstream LeetHub.
2. Set up or link a repository for your solutions.
3. On a LeetCode problem, use the floating widget: **Start initial approach** → **Stop & start solving** → submit. Your solution commits to GitHub as before; a form also opens for the interview-prep log.
4. Open the **dashboard** (from the popup) to see what's due, your plan position, and every attempt you've logged.

![leetcode view](assets/extension/leetcode_updated.png)

## Interview tracker

A timer and a notes form for interview prep. Each attempt is appended to `interview_tracker.csv` in your LeetHub
GitHub repo, using the GitHub sign-in LeetHub already has. No extra setup.

- On a LeetCode problem, use the floating widget: **Start initial approach** → **Stop & start solving** → submit.
- When the submission is accepted, a form opens pre-filled (problem, difficulty, pattern, times, Leitner box).
  Fill in the rest and save. **Log attempt** opens the same form any time (defaults to Failed if the page isn't
  showing Accepted) — use it for a Failed/Partial attempt, or if the form didn't open on its own.
- The popup lists problems **due for review** using Leitner intervals (box 1-5 → 2/4/8/16/30 days) and links to the dashboard.
- Toggle the tracker off in the popup.

### Dashboard

Popup → **Open dashboard** (or `dashboard.html?demo` to preview with sample data). It replaces the spreadsheet:

- **Today**: every due review (no cap — nothing gets buried in a backlog), a plan position that follows your
  progress (not the calendar), a daily target of new problems from the plan, and solved-problem stats.
- **Attempts**: every attempt with the workbook's computed columns (interval, next review, days until due, due flag).
  Only a problem's latest attempt is live; older attempts show as *superseded* instead of staying due forever. Click a row to edit or delete it.
- **Problems**: the plan's problem list week by week, with your status, attempts and next review; filter by week, pattern or status.
- **Plan / Reference**: the 8-week plan and problem list (auto-ticked from your attempts), pattern cheatsheet, Leitner guide.
- **Import CSV**: bring in history exported from a spreadsheet-based tracker's Problem Tracker tab (dates, Excel serial dates and missing links are handled; duplicates are skipped).

The CSV columns follow a typical "Problem Tracker" spreadsheet layout, so you can open `interview_tracker.csv` in
Excel/Sheets too. The bundled plan/reference content was extracted from a spreadsheet template with
`tools/extract-workbook.py`.

## Local development / installation

GritHub isn't (yet) published on addons.mozilla.org, so install it from source:

<ol>
  <li>Fork or clone <a href="https://github.com/Dubbus/GritHub">this repo</a></li>
  <li>Run <code>npm run setup</code> to install the developer dependencies</li>
  <li>Run <code>npm run build</code> to build the addon files into <code>./dist/</code></li>
  <li>Go to <a href="about://debugging#/runtime/this-firefox">about:debugging#/runtime/this-firefox</a></li>
  <li>Click <strong>Load Temporary Add-on…</strong></li>
  <li>Select <code>./dist/manifest.json</code></li>
  <li>That's it! Re-run <code>npm run build</code> and reload the addon after making changes.</li>
</ol>

Other npm commands available:

```
npm run               Show list of commands available
npm run format        Auto-format JavaScript, HTML/CSS
npm run format-test   Test all code is formatted properly
npm run lint          Lint JavaScript
npm run lint-test     Test all code is linted properly
```
