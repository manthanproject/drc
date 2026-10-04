import { defineEnvVars } from '@sveltejs/kit/env';
import { building, dev } from '$app/env';

/**
 * Never crash the whole app over one missing setting (4 Oct: a missing CRON_SECRET took DRC down).
 * A missing value is logged once at start-up; only the feature that needs it fails, and /api/health lists it.
 */
const requiredLive = (name: string) => (value: string | undefined) => {
	if (!value && !building && !dev) console.error(`[env] ${name} is not set`);
	return value ?? '';
};

export const variables = defineEnvVars({
	SUPABASE_URL: { description: 'Supabase project URL (drc, Mumbai)', schema: requiredLive('SUPABASE_URL') },
	SUPABASE_SECRET_KEY: { description: 'Supabase secret key, server only, bypasses RLS', schema: requiredLive('SUPABASE_SECRET_KEY') },
	GOOGLE_SA_KEY_JSON: { description: 'drc-reader service account JSON key', schema: requiredLive('GOOGLE_SA_KEY_JSON') },
	DROPPY_LOG_ID: { description: 'DROPPY-Log spreadsheet ID (read only)', schema: requiredLive('DROPPY_LOG_ID') },
	RETURN_ORDERS_ID: { description: 'Dropy Return Orders spreadsheet ID', schema: requiredLive('RETURN_ORDERS_ID') },
	DRC_UPLOADER_URL: { description: 'Apps Script web app URL (DRC Uploader on warhawkchaos)', schema: requiredLive('DRC_UPLOADER_URL') },
	DRC_UPLOADER_TOKEN: { description: 'Shared secret for DRC Uploader', schema: requiredLive('DRC_UPLOADER_TOKEN') },
	APP_PASSWORD: { description: 'Single shared DRC login password', schema: requiredLive('APP_PASSWORD') },
	VELOCITY_API_URL: { description: 'Velocity Shipping API base URL', schema: requiredLive('VELOCITY_API_URL') },
	VELOCITY_API_KEY: { description: 'Velocity API key named DRC (Settings > API Keys, Bearer, up to 365 days)', schema: requiredLive('VELOCITY_API_KEY') },
	CRON_SECRET: { description: 'Shared secret Supabase pg_cron sends to /api/sync/*', schema: requiredLive('CRON_SECRET') },
	VERCEL_REGION: { description: 'Set by Vercel at runtime', schema: (v: string | undefined) => v ?? '' }
});