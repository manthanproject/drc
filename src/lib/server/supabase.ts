import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SECRET_KEY } from '$app/env/private';

let client: SupabaseClient | null = null;

/** Server-only Supabase client (secret key, bypasses RLS). Never import in client code. */
export function db(): SupabaseClient {
	if (!client) {
		if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error('Supabase env vars missing');
		client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
	}
	return client;
}