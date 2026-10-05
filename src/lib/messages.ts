// Customer message drafts (copy → paste into WhatsApp). Wording is the CS playbook's template
// "E. RTO RETURNED", reproduced exactly; COD orders get the playbook's "no refund option" variant.

export interface DraftRto {
	order_no: string | null;
	customer_name: string | null;
	payment_mode: 'cod' | 'prepaid' | 'partial' | null;
}

/** 'priya sharma' → 'Priya' (first name, capitalised). */
export function firstName(full: string | null | undefined): string | null {
	const w = String(full ?? '').trim().split(/\s+/)[0] ?? '';
	if (!/[a-z]/i.test(w)) return null;
	return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

export function rtoReturnedDraft(r: DraftRto): string {
	const name = firstName(r.customer_name);
	const order = `#Dropy-${r.order_no ?? ''}`;
	const options =
		r.payment_mode === 'cod'
			? `We'd like to reship this to you — could you please reconfirm your delivery address so we can dispatch it again without any further issues?`
			: `We'd like to check with you — would you like us to:

1️⃣ **Reship the product** to you (please confirm/reconfirm your address), or
2️⃣ **Process a full refund** to your original payment method

Please let us know your preference and we'll take care of it right away.`;
	return `Hi ${name ?? 'there'}, this is Team Dropy. 🙏

We're sorry to inform you that your order **${order}** could not be delivered and has been returned to our warehouse (RTO).

${options}

We sincerely apologize for the inconvenience. 🙏

— Team Dropy`;
}
