import {
	VELOCITY_MCP_URL,
	VELOCITY_MCP_ACCESS_TOKEN,
	VELOCITY_MCP_CLIENT,
	VELOCITY_MCP_UID
} from '$app/env/private';

/** Thrown when Velocity rejects the MCP key (expired / wrong). DRC shows a "renew key" banner. */
export class VelocityAuthError extends Error {}

let sessionId: string | null = null;
let rpcId = 1;

function headers(): Record<string, string> {
	if (!VELOCITY_MCP_URL || !VELOCITY_MCP_ACCESS_TOKEN || !VELOCITY_MCP_UID) {
		throw new Error('Velocity MCP env vars missing');
	}
	const h: Record<string, string> = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
		'access-token': VELOCITY_MCP_ACCESS_TOKEN,
		client: VELOCITY_MCP_CLIENT || 'mcp',
		uid: VELOCITY_MCP_UID
	};
	if (sessionId) h['mcp-session-id'] = sessionId;
	return h;
}

/** Reads a JSON-RPC reply that may come back as plain JSON or as an SSE stream. */
async function readReply(r: Response, id: number): Promise<any> {
	const text = await r.text();
	if ((r.headers.get('content-type') ?? '').includes('text/event-stream')) {
		for (const line of text.split(/\r?\n/)) {
			if (!line.startsWith('data:')) continue;
			try {
				const msg = JSON.parse(line.slice(5).trim());
				if (msg.id === id) return msg;
			} catch {
				/* keep scanning */
			}
		}
		throw new Error(`No reply for request ${id} in event stream`);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`Velocity returned non-JSON (HTTP ${r.status}): ${text.slice(0, 160)}`);
	}
}

async function rpc(method: string, params: unknown, notify = false): Promise<any> {
	const id = rpcId++;
	const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
	const r = await fetch(VELOCITY_MCP_URL, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
	if (r.status === 401 || r.status === 403) throw new VelocityAuthError(`Velocity MCP key rejected (HTTP ${r.status})`);
	const sid = r.headers.get('mcp-session-id');
	if (sid) sessionId = sid;
	if (notify) return null;
	const msg = await readReply(r, id);
	if (msg.error) {
		const m = String(msg.error.message ?? JSON.stringify(msg.error));
		if (/unauthori[sz]ed|expired|invalid token|forbidden/i.test(m)) throw new VelocityAuthError(m);
		throw new Error(`Velocity ${method}: ${m}`);
	}
	return msg.result;
}

let initialised = false;

async function ensureSession() {
	if (initialised) return;
	try {
		await rpc('initialize', {
			protocolVersion: '2025-03-26',
			capabilities: {},
			clientInfo: { name: 'drc', version: '0.1' }
		});
		await rpc('notifications/initialized', {}, true);
	} catch (e) {
		if (e instanceof VelocityAuthError) throw e;
		// Some MCP servers are stateless and skip the handshake; carry on and let the real call decide.
	}
	initialised = true;
}

export async function listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]> {
	await ensureSession();
	const res = await rpc('tools/list', {});
	return res?.tools ?? [];
}

/** Calls a Velocity MCP tool and returns its parsed payload (JSON text content is decoded). */
export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
	await ensureSession();
	const res = await rpc('tools/call', { name, arguments: args });
	if (res?.isError) throw new Error(`Velocity tool ${name} failed: ${JSON.stringify(res.content).slice(0, 200)}`);
	if (res?.structuredContent) return res.structuredContent;
	const parts = (res?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text);
	if (parts.length === 1) {
		try {
			return JSON.parse(parts[0]);
		} catch {
			return parts[0];
		}
	}
	return parts.length ? parts : res;
}
