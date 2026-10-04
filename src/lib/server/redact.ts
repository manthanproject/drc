const PII = /phone|mobile|email|address|pincode|pin_code|zipcode|^zip$|landmark|(customer|consignee|buyer|receiver|billing|shipping)_?name|^name$/i;

/** Masks customer PII and trims long arrays so payloads can be shared safely for inspection. */
export function redact(v: unknown, depth = 0): unknown {
	if (depth > 8) return '…';
	if (Array.isArray(v)) {
		const out = v.slice(0, 3).map((x) => redact(x, depth + 1));
		if (v.length > 3) out.push(`… ${v.length - 3} more`);
		return out;
	}
	if (v && typeof v === 'object') {
		const o: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v)) {
			o[k] = PII.test(k) && (typeof val === 'string' || typeof val === 'number') ? '•••' : redact(val, depth + 1);
		}
		return o;
	}
	if (typeof v === 'string' && v.length > 300) return v.slice(0, 300) + '…';
	return v;
}
