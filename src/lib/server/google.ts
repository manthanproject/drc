import { sheets, type sheets_v4 } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { GOOGLE_SA_KEY_JSON } from '$app/env/private';

let sheetsClient: sheets_v4.Sheets | null = null;

/** Read-only Sheets client using the drc-reader service account. */
export function sheetsReadonly(): sheets_v4.Sheets {
	if (!sheetsClient) {
		if (!GOOGLE_SA_KEY_JSON) throw new Error('GOOGLE_SA_KEY_JSON missing');
		const auth = new GoogleAuth({
			credentials: JSON.parse(GOOGLE_SA_KEY_JSON),
			scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
		});
		sheetsClient = sheets({ version: 'v4', auth });
	}
	return sheetsClient;
}
let writerClient: sheets_v4.Sheets | null = null;

/**
 * Sheets client that can WRITE. Used ONLY by ready-stock-sheet.ts, which touches nothing but the
 * "DRC Ready Stock" tab of Dropy Return Orders (drc-reader is Editor there; DROPPY-Log stays Viewer).
 */
export function sheetsWriter(): sheets_v4.Sheets {
	if (!writerClient) {
		if (!GOOGLE_SA_KEY_JSON) throw new Error('GOOGLE_SA_KEY_JSON missing');
		const auth = new GoogleAuth({
			credentials: JSON.parse(GOOGLE_SA_KEY_JSON),
			scopes: ['https://www.googleapis.com/auth/spreadsheets']
		});
		writerClient = sheets({ version: 'v4', auth });
	}
	return writerClient;
}
