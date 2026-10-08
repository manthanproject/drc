import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followState, followText, withdrawText, creditOutcome, creditTarget, type FollowClaim } from '../src/lib/followups.ts';
import { DEFAULT_RULES } from '../src/lib/dashboard.ts';
import { describe as say } from '../src/lib/history.ts';

const NOW = Date.parse('2026-10-07T16:00:00Z'); // 7 Oct 9:30 pm IST
const H = 3_600_000;
const c = (p: Partial<FollowClaim> = {}): FollowClaim => ({ id: 'c', rto_id: 'r', reason: 'mdnd', status: 'raised', channel: 'panel_dispute', claimed_amount: 1158, raised_at: '2026-10-05T12:34:00Z', ...p });
const r = { order_no: '3225', forward_awb: '7D139887356', carrier_name: 'DTDC Standard', order_value: 1158, rto_delivered_at: '2026-10-02T15:31:00Z', disputes: null as any };

test('follow state: due after 48 h, waiting before, rejected, approved, credit due', () => {
	assert.deepEqual(followState(c(), r, DEFAULT_RULES, NOW), { kind: 'due', label: 'Follow up now', tone: 'warn', due: Date.parse('2026-10-07T12:34:00Z') });
	assert.equal(followState(c({ raised_at: '2026-10-07T06:00:00Z' }), r, DEFAULT_RULES, NOW)!.label, 'Follow up 9 Oct');
	assert.equal(followState(c({ next_follow_up_at: '2026-10-09T16:00:00Z' }), r, DEFAULT_RULES, NOW)!.kind, 'waiting', 'a follow-up pushed the date');
	const rej = { ...r, disputes: [{ id: 'd', status: 'rejected', dispute_type: 'mdnd', raised_at: '2026-10-05T12:34:00Z' }] };
	assert.deepEqual(followState(c(), rej, DEFAULT_RULES, NOW), { kind: 'rejected', label: 'Rejected · escalate', tone: 'bad', due: null });
	assert.equal(followState(c({ status: 'escalated', next_follow_up_at: '2026-10-09T16:00:00Z' }), rej, DEFAULT_RULES, NOW)!.kind, 'waiting', 'escalated: back to waiting');
	assert.equal(followState(c({ channel: 'support_ticket', ticket_ref: '#1' }), rej, DEFAULT_RULES, NOW)!.kind, 'due', 'tickets ignore the panel dispute');
	const ok = { ...r, disputes: [{ id: 'd', status: 'approved', dispute_type: 'mdnd', raised_at: '2026-10-05T12:34:00Z' }] };
	assert.equal(followState(c(), ok, DEFAULT_RULES, NOW)!.kind, 'courier_approved');
	assert.equal(followState(c({ status: 'approved' }), r, DEFAULT_RULES, NOW)!.kind, 'credit_due');
	assert.equal(followState(c({ status: 'draft' }), r, DEFAULT_RULES, NOW), null);
	assert.equal(followState(c({ status: 'closed' }), r, DEFAULT_RULES, NOW), null);
	assert.equal(followState(c({ raised_at: null }), r, DEFAULT_RULES, NOW)!.label, 'Waiting');
	assert.equal(followState(c({ raised_at: '2026-10-06T10:00:00Z' }), r, { ...DEFAULT_RULES, followHours: 24 }, NOW)!.kind, 'due', 'setting respected');
	void H;
});

test('panel dispute follow-up: new ticket, facts, one request, Team Dropy', () => {
	const t = followText(c(), r, 'due');
	assert.equal(t.where, 'New Velocity support ticket');
	assert.equal(t.subject, 'FOLLOW-UP: MDND dispute | AWB 7D139887356 | #Dropy-3225');
	assert.equal(t.body, [
		'Hi Team,',
		'',
		'Following up on our MDND dispute for the RTO below, raised on 5 Oct 2026.',
		'',
		'Order: #Dropy-3225',
		'AWB: 7D139887356 (DTDC)',
		'Order value: ₹1,158',
		'Issue: Marked "Return - Delivered" on 2 Oct 2026 at 9:01 pm, but it never reached our warehouse.',
		'',
		'It still shows "In Review" with no update. Please share the POD (receiver signature, delivery photo, receiver name and ID), or settle the claim for the order value within 24 hours.',
		'',
		'Thanks & Regards,',
		'Team Dropy',
		'support@dropy.in'
	].join('\n'));
	assert.ok(!/costech/i.test(t.body));
	assert.match(followText(c({ reason: 'wrong_product' }), r, 'due').body, /different product inside[\s\S]*approve the claim and issue the credit note/);
});

test('ticket follow-up is a reply on the same ticket', () => {
	const t = followText(c({ channel: 'support_ticket', reason: 'lost', ticket_ref: '#106500' }), r, 'due');
	assert.equal(t.where, 'Reply on ticket #106500');
	assert.equal(t.subject, null);
	assert.match(t.body, /^Following up on this ticket, raised on 5 Oct 2026\. We have not had an update yet\.$/m);
	assert.match(t.body, /^Please update us on every AWB in this ticket within 24 hours\.$/m);
});

test('rejected → escalation ticket with packing video', () => {
	const t = followText(c(), r, 'rejected', 'https://drive.google.com/file/d/p/view');
	assert.equal(t.subject, 'ESCALATION: MDND dispute rejected | AWB 7D139887356 | #Dropy-3225');
	assert.match(t.body, /^Our MDND dispute for the RTO below \(raised on 5 Oct 2026\) was rejected\. Please re-check it\.$/m);
	assert.match(t.body, /^Pre-dispatch packing video with label: https:\/\/drive\.google\.com\/file\/d\/p\/view$/m);
	assert.match(t.body, /within 48 hours\.\n\nThanks & Regards,/);
	assert.ok(!followText(c(), r, 'rejected').body.includes('packing video'));
});

test('credit chase, withdraw line, credit outcome', () => {
	const a = c({ status: 'approved', approved_at: '2026-10-06T06:00:00Z', approved_amount: 1000 });
	const t = followText(a, r, 'credit_due');
	assert.match(t.body, /approved on 6 Oct 2026, but we have not received the credit yet[\s\S]*Approved amount: ₹1,000[\s\S]*credit note number and date/);
	assert.equal(withdrawText(c(), { ...r, order_no: '3136', forward_awb: '7D139886865' }).body.split('\n')[0],
		'Update: RTO for #Dropy-3136 (AWB 7D139886865) has now been received at our warehouse. Please close this dispute.');
	assert.equal(withdrawText(c({ channel: 'support_ticket', ticket_ref: '#9' }), r).where, 'Reply on ticket #9');
	assert.equal(creditTarget(c({ expected_amount: 2500, claimed_amount: 3977 })), 2500);
	assert.equal(creditOutcome(c({ expected_amount: 2500, claimed_amount: 3977 }), 1728), 'short');
	assert.equal(creditOutcome(c({ expected_amount: 2500 }), 2500), 'full');
	assert.equal(creditOutcome(c(), 0), null);
});

test('history wording for follow-ups', () => {
	const ev = (payload: any) => ({ id: 1, source: 'user', kind: 'stage_change', payload, received_at: '2026-10-07T06:00:00Z' });
	assert.equal(say(ev({ action: 'claim_follow_up', args: { ticket_ref: '#106500', n: 2 } })).text, 'Followed up (2nd time) on ticket #106500');
	assert.equal(say(ev({ action: 'claim_follow_up', args: { n: 1 } })).text, 'Followed up (1st time)');
	assert.equal(say(ev({ action: 'claim_escalated', args: { ticket_ref: '#107001' } })).text, 'Rejected dispute escalated (ticket #107001)');
	assert.equal(say(ev({ action: 'claim_withdrawn', args: { note: 'parcel arrived' } })).text, 'Claim withdrawn — parcel arrived');
	assert.equal(say(ev({ action: 'claim_approved', args: { amount: 1500 } })).text, 'Claim approved (₹1,500)');
	assert.equal(say(ev({ action: 'claim_credited', args: { ticket_ref: 'VSF/FN/1026/096', amount: 1728, result: 'short_paid_accepted' } })).text,
		'Credit VSF/FN/1026/096 ₹1,728 received, claim closed (short-paid)');
});
