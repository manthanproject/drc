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
	DRC_UPLOADER_URL: { description: 'Apps Script web app URL (DRC Uploader on warhawkchaos)', schema: requiredLive('DRC_UPLOADER_URL') },
	DRC_UPLOADER_TOKEN: { description: 'Shared secret for DRC Uploader', schema: requiredLive('DRC_UPLOADER_TOKEN') },
	APP_PASSWORD: { description: 'Single shared DRC login password', schema: requiredLive('APP_PASSWORD') },
	VELOCITY_MCP_URL: { description: 'Velocity MCP endpoint', schema: requiredLive('VELOCITY_MCP_URL') },
	VELOCITY_MCP_ACCESS_TOKEN: { description: 'Velocity MCP access-token header (expires ~10-14 days, renewed manually)', schema: requiredLive('VELOCITY_MCP_ACCESS_TOKEN') },
	VELOCITY_MCP_CLIENT: { description: 'Velocity MCP client header', schema: requiredLive('VELOCITY_MCP_CLIENT') },
	VELOCITY_MCP_UID: { description: 'Velocity MCP uid header', schema: requiredLive('VELOCITY_MCP_UID') },
	VELOCITY_API_URL: { description: 'Velocity Shipping API base URL', schema: requiredLive('VELOCITY_API_URL') },
	VELOCITY_API_KEY: { description: 'Velocity API key named DRC (Settings > API Keys, Bearer, up to 365 days)', schema: requiredLive('VELOCITY_API_KEY') },
	VERCEL_REGION: { description: 'Set by Vercel at runtime', schema: (v: string | undefined) => v ?? '' }
});