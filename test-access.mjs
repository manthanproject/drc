import { google } from 'googleapis';

const DROPPY_LOG_ID = '1jic6YmVgpRuudbuiU9DiS1q2rQ2m5IGdG4lJrv9CD8I';
const RETURN_ORDERS_ID = '1Aq6eRAquhQVDQn0ebBHJZqXrhZjfO8XqWUnV4G5aOJA';

const auth = new google.auth.GoogleAuth({
  keyFile: './secrets/drc-reader.json',
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
  ],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function check(label, id) {
  console.log(`\n=== ${label} ===`);
  try {
    const f = await drive.files.get({ fileId: id, fields: 'name,capabilities(canEdit)' });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(title,sheetId)' });
    const tabs = meta.data.sheets.map((s) => `${s.properties.title} (gid ${s.properties.sheetId})`);
    const first = meta.data.sheets[0].properties.title;
    const head = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${first}'!1:1` });
    const colA = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${first}'!A:A` });
    console.log('File name :', f.data.name);
    console.log('Can edit  :', f.data.capabilities.canEdit);
    console.log('Tabs      :', tabs.join(' | '));
    console.log('Headers   :', (head.data.values?.[0] || []).join(' | '));
    console.log('Data rows :', Math.max((colA.data.values?.length || 0) - 1, 0));
  } catch (e) {
    console.log('FAILED    :', e.code, e.message);
  }
}

await check('DROPPY-Log (expect Can edit: false)', DROPPY_LOG_ID);
await check('Dropy Return Orders (expect Can edit: true)', RETURN_ORDERS_ID);