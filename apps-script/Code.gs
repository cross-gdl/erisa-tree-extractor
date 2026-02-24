/**
 * Apps Script web app that receives CSV data via POST and writes it
 * to the "All Sources" tab of the bound spreadsheet.
 *
 * Deployment steps:
 *   1. Open your target Google Sheet
 *   2. Extensions > Apps Script
 *   3. Paste this entire file into Code.gs
 *   4. Deploy > New deployment > Web app
 *      - Execute as: Me
 *      - Who has access: Anyone (or Anyone with a Google account)
 *   5. Copy the web app URL and put it in config.json as "googleSheetWebAppUrl"
 */

function doPost(e) {
  try {
    var csvText = e.postData.contents;
    if (!csvText || csvText.trim().length === 0) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Empty CSV data' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var rows = parseCsv(csvText);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('All Sources');
    if (!sheet) {
      sheet = ss.insertSheet('All Sources');
    }

    sheet.clear();

    if (rows.length > 0) {
      var maxCols = rows.reduce(function(max, row) {
        return Math.max(max, row.length);
      }, 0);

      // Pad short rows so the range is rectangular
      var padded = rows.map(function(row) {
        while (row.length < maxCols) row.push('');
        return row;
      });

      sheet.getRange(1, 1, padded.length, maxCols).setValues(padded);

      // Bold the header row
      sheet.getRange(1, 1, 1, maxCols).setFontWeight('bold');
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, rows: rows.length - 1 }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * RFC 4180-compliant CSV parser that handles quoted fields.
 */
function parseCsv(text) {
  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    var next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else if (ch === '\r') {
        // skip, handle \r\n
      } else {
        field += ch;
      }
    }
  }

  // Last field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
