/**
 * Receives rows from the LeetHub interview tracker extension and appends them
 * to the "interview_prep_tracker" sheet.
 *
 * Setup:
 *  1. Open your Google Sheet -> Extensions -> Apps Script, paste this file.
 *  2. Project Settings -> Script properties -> add SECRET = <any random string>.
 *     (Optional) add SHEET_NAME = <tab name>; defaults to the first tab.
 *  3. Deploy -> New deployment -> Web app -> Execute as: Me, Who has access: Anyone.
 *  4. Copy the /exec URL and the secret into the extension popup.
 *
 * Columns are matched by header text in row 1 (case/spacing/punctuation ignored),
 * so you can keep whatever layout the sheet already has. Unknown headers stay blank.
 */

// header (normalized) -> payload key. Payload keys themselves also match directly.
var ALIASES = {
  problemname: 'problem',
  title: 'problem',
  question: 'problem',
  link: 'url',
  difficultylevel: 'difficulty',
  tags: 'topics',
  topic: 'topics',
  category: 'topics',
  technique: 'pattern',
  approach: 'pattern',
  initialapproachtime: 'approachMinutes',
  initialapproach: 'approachMinutes',
  approachtime: 'approachMinutes',
  approachmin: 'approachMinutes',
  solvingtime: 'solveMinutes',
  solvetime: 'solveMinutes',
  timetosolve: 'solveMinutes',
  timetaken: 'totalMinutes',
  totaltime: 'totalMinutes',
  revisitlater: 'revisit',
  review: 'revisit',
  comments: 'notes',
  note: 'notes',
  lang: 'language',
  datesolved: 'date',
};

function normalize_(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var body = JSON.parse(e.postData.contents);

    var secret = props.getProperty('SECRET');
    if (!secret || body.secret !== secret) {
      return json_({ ok: false, error: 'Bad secret' });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var name = props.getProperty('SHEET_NAME');
    var sheet = name ? ss.getSheetByName(name) : ss.getSheets()[0];
    if (!sheet) return json_({ ok: false, error: 'Sheet tab not found: ' + name });

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var row = body.row || {};
    var byNorm = {};
    Object.keys(row).forEach(function (k) {
      byNorm[normalize_(k)] = row[k];
    });

    var unmatched = [];
    var values = headers.map(function (h) {
      var n = normalize_(h);
      if (n === '') return '';
      if (n in byNorm) return byNorm[n];
      if (n in ALIASES && ALIASES[n] in row) return row[ALIASES[n]];
      unmatched.push(h);
      return '';
    });

    sheet.appendRow(values);
    return json_({ ok: true, unmatchedColumns: unmatched });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
