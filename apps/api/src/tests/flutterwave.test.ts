import './testEnv';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPaymentConfigured, minorUnits, providerId, setFlutterwaveMock, verifyTransactionById, verifyWebhookSignature } from '../services/payment.service';
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
