import { json } from '@sveltejs/kit';
import { requirePassword } from '#lib/server/auth.ts';
import { listTools, callTool, VelocityAuthError } from '#lib/server/velocity.ts';
import { redact } from '#lib/server/redact.ts';
import type { RequestHandler } from './$types';

/**
 * Captures how the Velocity MCP really behaves (tool names, input schemas, one sample reply),
 * with customer PII masked. Read-only tools only.
 */
export const POST: RequestHandler = async ({ request }) => {
	requirePassword(request);
	const b = await request.json().catch(() => ({}));
	const out: Record<string, unknown> = {};
	try {
		const tools = await listTools();
		out.tools = tools.map((t) => ({ name: t.name, description: t.description?.slice(0, 200), inputSchema: t.inputSchema }));
		const tool = String(b.tool ?? 'list_shipments');
		if (!/^(list_|get_)/.test(tool)) return json({ ...out, error: 'probe allows read-only list_/get_ tools only' }, { status: 400 });
		out.sample = { tool, args: b.args ?? {}, reply: redact(await callTool(tool, b.args ?? {})) };
		return json(out);
	} catch (e) {
		const auth = e instanceof VelocityAuthError;
		return json({ ...out, error: e instanceof Error ? e.message : String(e), keyExpired: auth }, { status: auth ? 401 : 502 });
	}
};
