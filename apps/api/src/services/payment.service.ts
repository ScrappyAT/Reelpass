import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Flutterwave payment integration.
 *
 * No sandbox credentials are checked into this repository. When
 * `FLUTTERWAVE_SECRET_KEY` is unset the integration reports itself as
 * NOT CONFIGURED and every confirmation path fails closed — the API never
 * hardcodes or simulates a successful payment.
 *
 * All verification is server-side. We verify: transaction status, amount,
 * currency (NGN) and the transaction reference.
 */

const FLUTTERWAVE_BASE = 'https://api.flutterwave.com/v3';

function secretKey(): string | null {
  const key = env.FLUTTERWAVE_SECRET_KEY;
  if (!key) return null;
  const trimmed = key.trim();
  if (trimmed === '' || trimmed.includes('xxxx')) return null;
  return trimmed;
}

export function isPaymentConfigured(): boolean {
  return secretKey() !== null;
}

export function isWebhookConfigured(): boolean {
  const hash = env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;
  return Boolean(hash && hash.trim() !== '' && !hash.includes('xxxx'));
}

/**
 * Verify a Flutterwave webhook `verif-hash` header in constant time.
 * Flutterwave sends the configured secret hash verbatim in this header.
 */
export function verifyWebhookSignature(header: string | undefined): boolean {
  if (!isWebhookConfigured()) return false;
  if (!header) return false;
  const expected = env.FLUTTERWAVE_WEBHOOK_SECRET_HASH!;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface VerificationResult {
  ok: boolean;
  status?: string;
  /** Amount in minor units (kobo) as reported by the gateway. */
  amountKobo?: number;
  currency?: string;
  txRef?: string;
  transactionId?: string;
  raw?: unknown;
  reason?: string;
}

interface InitializeParams {
  bookingReference: string;
  amountKobo: number;
  customerEmail: string;
  customerName: string;
  redirectUrl?: string;
}

export interface InitializeResult {
  configured: boolean;
  link?: string;
  reference: string;
  message?: string;
}

/** Create a Flutterwave Standard checkout link (sandbox when test keys are used). */
export async function initializePayment(params: InitializeParams): Promise<InitializeResult> {
  const key = secretKey();
  const reference = `RP-PAY-${params.bookingReference}`;
  if (!key) {
    return {
      configured: false,
      reference,
      message:
        'Payment provider is not configured. Set FLUTTERWAVE_SECRET_KEY to enable checkout. No payment was attempted and no success has been recorded.',
    };
  }

  const body = {
    tx_ref: reference,
    amount: params.amountKobo / 100, // Flutterwave expects NGN major units
    currency: 'NGN',
    redirect_url: params.redirectUrl || 'https://reelpass.example/payment/callback',
    customer: { email: params.customerEmail, name: params.customerName },
    customizations: { title: 'ReelPass', description: `Cinema booking ${params.bookingReference}` },
  };

  const res = await fetch(`${FLUTTERWAVE_BASE}/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (!res.ok || json?.status !== 'success') {
    throw new Error(`Flutterwave initialize failed: ${json?.message || res.status}`);
  }
  return { configured: true, link: json.data?.link, reference };
}

function toResult(json: any): VerificationResult {
  const data = json?.data;
  if (!data) return { ok: false, reason: 'No transaction data returned' };
  return {
    ok: json.status === 'success' && data.status === 'successful',
    status: data.status,
    amountKobo: typeof data.amount === 'number' ? Math.round(data.amount * 100) : undefined,
    currency: data.currency,
    txRef: data.tx_ref,
    transactionId: data.id !== undefined ? String(data.id) : undefined,
    raw: json,
    reason: json.status === 'success' ? undefined : json.message,
  };
}

async function flwGet(path: string): Promise<any> {
  const key = secretKey();
  if (!key) throw new Error('Payment provider is not configured');
  const res = await fetch(`${FLUTTERWAVE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return res.json();
}

export async function verifyTransactionById(transactionId: string | number): Promise<VerificationResult> {
  return toResult(await flwGet(`/transactions/${encodeURIComponent(String(transactionId))}/verify`));
}

export async function verifyTransactionByReference(txRef: string): Promise<VerificationResult> {
  const json = await flwGet(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
  return toResult(json);
}
