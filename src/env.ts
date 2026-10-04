import { defineEnvVars } from '@sveltejs/kit/env';
import { building, dev } from '$app/env';

/** Required on the live server; optional while building or in local dev. */
const requiredLive = (name: string) => (value: string | undefined) => {
	if (!value && !building && !dev) throw new Error(`${name} is not set`);
	return value ?? '';
};

export const variables = defineEnvVars({
	SUPABASE_URL: { description: 'Supabase project URL (drc, Mumbai)', schema: requiredLive('SUPABASE_URL') },
	SUPABASE_SECRET_KEY: { description: 'Supabase secret key, server only, bypasses RLS', schema: requiredLive('SUPABASE_SECRET_KEY') },
	GOOGLE_SA_KEY_JSON: { description: 'drc-reader service account JSON key', schema: requiredLive('GOOGLE_SA_KEY_JSON') },
	DROPPY_LOG_ID: { description: 'DROPPY-Log spreadsheet ID (read only)', schema: requiredLive('DROPPY_LOG_ID') },
	RETURN_ORDERS_ID: { description: 'Dropy Return Orders spreadsheet ID', schema: requiredLive('RETURN_ORDERS_ID') },
	VERCEL_REGION: { description: 'Set by Vercel at runtime', schema: (v: string | undefined) => v ?? '' }
});