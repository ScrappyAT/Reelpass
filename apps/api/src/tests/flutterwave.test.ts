import './testEnv';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLegitimateFlutterwaveCheckoutUrl,
  initializePayment,
  isPaymentConfigured,
  minorUnits,
  providerId,
  setFlutterwaveMock,
  verifyTransactionById,
  verifyWebhookSignature,
} from '../services/payment.service';
import { validateTransaction } from '../services/paymentWorkflow';

test('only a matching Flutterwave v3 webhook secret is accepted', () => {
  assert.equal(verifyWebhookSignature(undefined), false);
  assert.equal(verifyWebhookSignature('wrong'), false);
  assert.equal(verifyWebhookSignature('isolated-test-webhook-secret'), true);
});

test('gateway values require whole minor units and exact transaction IDs', () => {
  assert.equal(minorUnits(75.01), 7501);
  for (const value of [0, -1, NaN, 0.001, '75', Infinity]) assert.equal(minorUnits(value), undefined);
  for (const value of ['001', '12-other', 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(providerId(value), undefined);
  assert.equal(providerId('9001'), '9001');
});

test('settlement policy rejects a mismatch or omission in every trusted field', () => {
  const expected = { id: '9001', reference: 'RP-PAY-123', amount: 750000, currency: 'NGN', status: 'successful' };
  const valid = { transactionId: '9001', reference: expected.reference, amountKobo: expected.amount, currency: 'NGN', status: 'successful' };
  assert.equal(validateTransaction(valid, expected), null);
  assert.equal(validateTransaction({ ...valid, amountKobo: 1 }, expected), 'AMOUNT_MISMATCH');
  assert.equal(validateTransaction({ ...valid, currency: 'USD' }, expected), 'CURRENCY_MISMATCH');
  assert.equal(validateTransaction({ ...valid, reference: 'other' }, expected), 'REFERENCE_MISMATCH');
  assert.equal(validateTransaction({ ...valid, status: 'failed' }, expected), 'PAYMENT_STATUS_MISMATCH');
  for (const field of Object.keys(valid)) assert.ok(validateTransaction({ ...valid, [field]: undefined }, expected));
});

test('gateway verification is disabled without a sandbox key and rejects HTTP and payload errors', async () => {
  assert.equal(isPaymentConfigured(), false);
  await assert.rejects(verifyTransactionById('9001'), /SANDBOX_NOT_CONFIGURED/);
  try {
    setFlutterwaveMock(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await assert.rejects(verifyTransactionById('9001'), /GATEWAY_HTTP_503/);
    setFlutterwaveMock(async () => ({ ok: true, status: 200, json: async () => ({ status: 'error' }) }));
    await assert.rejects(verifyTransactionById('9001'), /GATEWAY_INVALID_RESPONSE/);
  } finally { setFlutterwaveMock(null); }
});

test('validates legitimate Flutterwave checkout URLs and rejects unauthorized hosts/protocols', () => {
  // Legitimate Flutterwave checkout endpoints from exact allowlist
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-123')), true);
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://checkout-v3.flutterwave.com/v3/hosted/pay/flwlnk-456')), true);
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://flutterwave.com/pay/reelpass')), true);

  // Unverified/arbitrary subdomains must be rejected (no broad *.flutterwave.com wildcard)
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://sub.checkout.flutterwave.com/pay')), false);
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://api.flutterwave.com/pay')), false);
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://arbitrary.flutterwave.com/pay')), false);

  // Insecure protocol (HTTP) must be rejected
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('http://checkout.flutterwave.com/v3/hosted/pay/flwlnk-123')), false);
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('http://checkout-v3.flutterwave.com/v3/hosted/pay/flwlnk-123')), false);

  // Embedded credentials must be rejected
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://user:pass@checkout.flutterwave.com/pay')), false);

  // Non-standard ports must be rejected
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://checkout.flutterwave.com:8080/pay')), false);

  // External / untrusted domains must be rejected
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://evil-flutterwave.com/pay')), false);
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://checkout.flutterwave.com.attacker.com/pay')), false);
  assert.equal(isLegitimateFlutterwaveCheckoutUrl(new URL('https://attacker.com/checkout.flutterwave.com')), false);
});

test('initializePayment accepts legitimate checkout links and logs safe diagnostics without leaking secrets', async () => {
  const logged: Array<{ level: string; msg: string }> = [];
  const origInfo = console.info;
  const origWarn = console.warn;
  console.info = (msg: string) => { logged.push({ level: 'info', msg }); origInfo(msg); };
  console.warn = (msg: string) => { logged.push({ level: 'warn', msg }); origWarn(msg); };

  const input = {
    reference: 'RP-PAY-123',
    amountKobo: 750000,
    currency: 'NGN',
    email: 'user@example.test',
    name: 'Ada Lovelace',
  };

  try {
    // 1. Primary checkout domain
    setFlutterwaveMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-secret-token-abc123' },
      }),
    }));
    const link1 = await initializePayment(input);
    assert.equal(link1, 'https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-secret-token-abc123');

    // 2. v3 modal / frontend domain
    setFlutterwaveMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: { link: 'https://checkout-v3.flutterwave.com/v3/hosted/pay/flwlnk-secret-token-xyz789' },
      }),
    }));
    const link2 = await initializePayment(input);
    assert.equal(link2, 'https://checkout-v3.flutterwave.com/v3/hosted/pay/flwlnk-secret-token-xyz789');

    // 3. Rejection of unauthorized domain
    setFlutterwaveMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: { link: 'https://evil-gateway.com/v3/hosted/pay/token' },
      }),
    }));
    await assert.rejects(initializePayment(input), /GATEWAY_INVALID_CHECKOUT_LINK/);

    // 4. Rejection of non-string link
    setFlutterwaveMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: { link: 12345 },
      }),
    }));
    await assert.rejects(initializePayment(input), /GATEWAY_INVALID_CHECKOUT_LINK/);

    // 5. Verify diagnostic logging safety
    assert.ok(logged.length > 0, 'Must produce diagnostic logs');
    for (const log of logged) {
      // Must NEVER log secret tokens or full payment link
      assert.ok(!log.msg.includes('flwlnk-secret-token-abc123'), 'Log must not contain checkout token abc123');
      assert.ok(!log.msg.includes('flwlnk-secret-token-xyz789'), 'Log must not contain checkout token xyz789');
      assert.ok(!log.msg.includes('/v3/hosted/pay/'), 'Log must not contain checkout URL path');
      assert.ok(!log.msg.includes('user@example.test'), 'Log must not contain customer email');

      // Diagnostics must log safe fields
      const parsed = JSON.parse(log.msg);
      assert.ok(['checkout_link_diagnostic', 'checkout_link_rejected'].includes(parsed.event));
      assert.ok(Array.isArray(parsed.responseShape) || typeof parsed.responseShape === 'string');
    }
  } finally {
    console.info = origInfo;
    console.warn = origWarn;
    setFlutterwaveMock(null);
  }
});
