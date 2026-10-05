import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rtoReturnedDraft, firstName } from '../src/lib/messages.ts';

test('first name', () => {
	assert.equal(firstName('PRIYA sharma'), 'Priya');
	assert.equal(firstName('  '), null);
	assert.equal(firstName('9876'), null);
});

test('prepaid / partial: playbook template E with reship + refund options, no placeholders', () => {
	const m = rtoReturnedDraft({ order_no: '2726', customer_name: 'anita rao', payment_mode: 'prepaid' });
	assert.equal(m, `Hi Anita, this is Team Dropy. 🙏

We're sorry to inform you that your order **#Dropy-2726** could not be delivered and has been returned to our warehouse (RTO).

We'd like to check with you — would you like us to:

1️⃣ **Reship the product** to you (please confirm/reconfirm your address), or
2️⃣ **Process a full refund** to your original payment method

Please let us know your preference and we'll take care of it right away.

We sincerely apologize for the inconvenience. 🙏

— Team Dropy`);
	assert.ok(!/\[|XXXX/.test(m));
	assert.ok(rtoReturnedDraft({ order_no: '3544', customer_name: 'X', payment_mode: 'partial' }).includes('Process a full refund'));
});

test('COD: the "no refund option" variant (nothing was paid)', () => {
	const m = rtoReturnedDraft({ order_no: '2876', customer_name: 'Meera Gupta', payment_mode: 'cod' });
	assert.ok(m.startsWith('Hi Meera, this is Team Dropy. 🙏'));
	assert.ok(m.includes('could you please reconfirm your delivery address'));
	assert.ok(!m.includes('refund'));
});
