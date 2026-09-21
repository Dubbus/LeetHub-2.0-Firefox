/*
 * Google Sheets integration for the interview tracker (runs in the background script).
 * OAuth via identity.launchWebAuthFlow (implicit flow, drive.file scope: the extension can
 * only touch spreadsheets it created itself). `api` is defined in background.js.
 */

const TRACKER_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TRACKER_SHEET_TITLE = 'interview_prep_tracker';
const TRACKER_HEADERS = [
  'Date',
  'Problem',
  'Difficulty',
  'Topics',
  'Pattern',
  'Initial Approach (min)',
  'Solving (min)',
  'Total (min)',
  'Confidence',
  'Revisit',
  'Notes',
  'Language',
  'Runtime',
  'Memory',
  'URL',
];

// header (normalized) -> payload key. Payload keys themselves also match directly.
const TRACKER_ALIASES = {
  problemname: 'problem',
  title: 'problem',
  question: 'problem',
  link: 'url',
  tags: 'topics',
  topic: 'topics',
  category: 'topics',
  technique: 'pattern',
  approach: 'pattern',
  initialapproach: 'approachMinutes',
  initialapproachmin: 'approachMinutes',
  initialapproachtime: 'approachMinutes',
  approachtime: 'approachMinutes',
  solving: 'solveMinutes',
  solvingmin: 'solveMinutes',
  solvingtime: 'solveMinutes',
  solvetime: 'solveMinutes',
  total: 'totalMinutes',
  totalmin: 'totalMinutes',
  totaltime: 'totalMinutes',
  revisitlater: 'revisit',
  review: 'revisit',
  comments: 'notes',
  note: 'notes',
  lang: 'language',
};

const normalizeHeader = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

async function trackerStorage(keys) {
  return api.storage.local.get(keys);
}

/* ---------- OAuth ---------- */

function parseAuthResponse(redirectUrl) {
  const url = new URL(redirectUrl);
  const params = new URLSearchParams(url.hash.replace(/^#/, '') || url.search);
  if (params.get('error')) {
    throw new Error(`Google sign-in failed: ${params.get('error')}`);
  }
  const token = params.get('access_token');
  if (!token) throw new Error('Google sign-in returned no token');
  return { token, expiresAt: Date.now() + Number(params.get('expires_in') || 3600) * 1000 };
}

async function authorizeGoogle(interactive) {
  const { tracker_client_id } = await trackerStorage('tracker_client_id');
  if (!tracker_client_id) {
    throw new Error('Google client ID not set. Add it in the LeetHub popup.');
  }
  const params = new URLSearchParams({
    client_id: tracker_client_id,
    response_type: 'token',
    redirect_uri: api.identity.getRedirectURL(),
    scope: TRACKER_SCOPE,
  });
  if (!interactive) params.set('prompt', 'none');

  const redirect = await api.identity.launchWebAuthFlow({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    interactive,
  });
  const { token, expiresAt } = parseAuthResponse(redirect);
  await api.storage.local.set({ tracker_token: token, tracker_token_exp: expiresAt });
  return token;
}

async function getAccessToken() {
  const { tracker_token, tracker_token_exp } = await trackerStorage([
    'tracker_token',
    'tracker_token_exp',
  ]);
  if (tracker_token && tracker_token_exp - 60000 > Date.now()) return tracker_token;
  try {
    return await authorizeGoogle(false); // silent refresh
  } catch (_) {
    return authorizeGoogle(true);
  }
}

async function sheetsFetch(url, options = {}, retried = false) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 401 && !retried) {
    await api.storage.local.remove(['tracker_token', 'tracker_token_exp']);
    return sheetsFetch(url, options, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error((body.error && body.error.message) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ---------- spreadsheet ---------- */

async function createTrackerSheet() {
  const bold = { textFormat: { bold: true } };
  const sheet = await sheetsFetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: TRACKER_SHEET_TITLE },
      sheets: [
        {
          properties: { title: 'Tracker', gridProperties: { frozenRowCount: 1 } },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: TRACKER_HEADERS.map(h => ({
                    userEnteredValue: { stringValue: h },
                    userEnteredFormat: bold,
                  })),
                },
              ],
            },
          ],
        },
      ],
    }),
  });
  await api.storage.local.set({
    tracker_sheet_id: sheet.spreadsheetId,
    tracker_sheet_url: sheet.spreadsheetUrl,
  });
  return sheet.spreadsheetUrl;
}

/* Popup "Connect" button: sign in and create the sheet if there isn't one yet. */
async function connectTracker() {
  try {
    await getAccessToken();
    const { tracker_sheet_url } = await trackerStorage('tracker_sheet_url');
    return { ok: true, sheetUrl: tracker_sheet_url || (await createTrackerSheet()) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* Popup "New sheet" button. */
async function newTrackerSheet() {
  try {
    await getAccessToken();
    return { ok: true, sheetUrl: await createTrackerSheet() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function appendToTracker(payload) {
  try {
    const { tracker_sheet_id } = await trackerStorage('tracker_sheet_id');
    if (!tracker_sheet_id) {
      return { ok: false, error: 'Not connected. Click "Connect Google" in the LeetHub popup.' };
    }
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${tracker_sheet_id}/values`;

    // Ranges without a tab name address the first tab, even if the user renamed it.
    const head = await sheetsFetch(`${base}/1:1`);
    const headers = (head.values && head.values[0]) || [];
    if (headers.length === 0) {
      return { ok: false, error: 'Row 1 of the sheet has no headers.' };
    }

    const byNorm = {};
    Object.keys(payload).forEach(k => (byNorm[normalizeHeader(k)] = payload[k]));
    const unmatched = [];
    const values = headers.map(h => {
      const n = normalizeHeader(h);
      if (n in byNorm) return byNorm[n];
      if (n in TRACKER_ALIASES && TRACKER_ALIASES[n] in payload) return payload[TRACKER_ALIASES[n]];
      unmatched.push(h);
      return '';
    });

    await sheetsFetch(`${base}/A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: [values] }),
    });
    return { ok: true, unmatchedColumns: unmatched };
  } catch (err) {
    if (err.status === 404) {
      return { ok: false, error: 'Sheet not found (deleted?). Use "New sheet" in the popup.' };
    }
    return { ok: false, error: err.message };
  }
}
