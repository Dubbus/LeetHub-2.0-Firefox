/*
 * Reads/writes interview_tracker.csv in the user's LeetHub GitHub repo, using LeetHub's own auth.
 * Shared by the content script (tracker.js) and the dashboard page.
 * Expects the global `BrowserUtil` (scripts/browserutil.js) like the rest of the extension.
 */
import { TRACKER_FILENAME, appendRow, parseRows, reviewSchedule } from './trackerCsv';
import { getGitHubFile, createTreeAndCommit, decode_base64, encode } from './upload';
import planProblems from '../dashboard/data/problems.json';

const SCHEDULE_TTL_MS = 60 * 60 * 1000;

const api = () => BrowserUtil.instance;

/** The plan's named problems (those with a link); lets rows without a link resolve to a LeetCode slug. */
export const PLAN_PROBLEMS = planProblems.filter(p => p.url);

/**
 * GitHub credentials from LeetHub's own auth, or null if unavailable. The in-page tracker can be
 * switched off in the popup; the dashboard passes requireEnabled: false since it's opened on purpose.
 */
export async function getAuth({ requireEnabled = true } = {}) {
  const { leethub_token, leethub_hook, mode_type, tracker_enabled } = await api().storage.local.get([
    'leethub_token',
    'leethub_hook',
    'mode_type',
    'tracker_enabled',
  ]);
  if (
    (requireEnabled && tracker_enabled === false) ||
    mode_type !== 'commit' ||
    !leethub_token ||
    !leethub_hook
  ) {
    return null;
  }
  return { token: leethub_token, hook: leethub_hook };
}

/** The CSV's text ('' if the file doesn't exist yet). */
export async function readCsv({ token, hook }) {
  try {
    const file = await getGitHubFile(token, hook, TRACKER_FILENAME);
    return decode_base64(file.content);
  } catch (err) {
    if (err.message === '404') return ''; // no tracker file yet
    throw err;
  }
}

/** Replaces the whole file in one commit (edit / delete / import). */
export async function writeCsv({ token, hook }, text, message) {
  await createTreeAndCommit(token, hook, [{ path: TRACKER_FILENAME, content: encode(text) }], message);
  await cacheSchedule(text);
}

export async function appendAttempt(auth, row) {
  const next = appendRow(await readCsv(auth), row);
  await writeCsv(auth, next, `Log ${row.name} attempt - LeetHub`);
}

/** Caches the review schedule for the popup (which filters by today's date at render time). */
export async function cacheSchedule(csvText) {
  await api().storage.local.set({
    tracker_reviews: reviewSchedule(parseRows(csvText), PLAN_PROBLEMS),
    tracker_reviews_at: Date.now(),
  });
}

/** Keeps the popup's review list fresh even if the CSV was edited elsewhere. Best effort. */
export async function refreshScheduleIfStale() {
  try {
    const auth = await getAuth();
    if (!auth) return;
    const { tracker_reviews_at } = await api().storage.local.get('tracker_reviews_at');
    if (tracker_reviews_at && Date.now() - tracker_reviews_at < SCHEDULE_TTL_MS) return;
    await cacheSchedule(await readCsv(auth));
  } catch (err) {
    console.error('LeetHub tracker: could not refresh review schedule', err);
  }
}
