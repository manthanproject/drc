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