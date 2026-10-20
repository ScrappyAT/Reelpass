import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Flutterwave payment integration for ReelPass.
 *
 * Configured via:
 * - FLW_SECRET_KEY or FLUTTERWAVE_SECRET_KEY
 * - FLW_SECRET_HASH or FLUTTERWAVE_WEBHOOK_SECRET_HASH
 * - FLW_CURRENCY (defaults to NGN)
 *
 * All verification is strictly server-side.
 * We verify: transaction status, reference, amount (in NGN kobo), currency, and uniqueness.
 * Secret keys are never logged or exposed to the client.
 */

const FLUTTERWAVE_BASE = 'https://api.flutterwave.com/v3';

type FetchMock = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
let mockFetch: FetchMock | null = null;

/** Test hook: allow unit and integration tests to mock Flutterwave API responses safely. */
export function setFlutterwaveMock(handler: FetchMock | null) {
  mockFetch = handler;
}

function secretKey(): string | null {
  const key = env.FLW_SECRET_KEY || env.FLUTTERWAVE_SECRET_KEY;
  if (!key) return null;
  const trimmed = key.trim();
  if (trimmed === '' || trimmed.includes('xxxx')) return null;
  return trimmed;
}

export function isPaymentConfigured(): boolean {
  return secretKey() !== null || mockFetch !== null;
}

export function getPaymentCurrency(): string {
  return env.FLW_CURRENCY || 'NGN';
}

export function isWebhookConfigured(): boolean {
  const hash = env.FLW_SECRET_HASH || env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;
  return Boolean(hash && hash.trim() !== '' && !hash.includes('xxxx'));
}

/**
 * Verify a Flutterwave webhook `verif-hash` header in constant time.
 */
export function verifyWebhookSignature(header: string | undefined): boolean {
  if (!isWebhookConfigured()) return false;
  if (!header) return false;
  const expected = (env.FLW_SECRET_HASH || env.FLUTTERWAVE_WEBHOOK_SECRET_HASH)!;
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

export interface InitializeParams {
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
  amountKobo: number;
  currency: string;
  message?: string;
}

/**
 * Create a Flutterwave Standard checkout session.
 * Generates a unique transaction reference per attempt to prevent reference collisions on retries.
 */
export async function initializePayment(params: InitializeParams): Promise<InitializeResult> {
  const key = secretKey();
  const currency = getPaymentCurrency();
  const reference = `RP-PAY-${params.bookingReference}-${Date.now()}`;

  if (!key && !mockFetch) {
    return {
      configured: false,
      reference,
      amountKobo: params.amountKobo,
      currency,
      message:
        'Payment provider is not configured. Set FLW_SECRET_KEY to enable checkout. No payment was attempted.',
    };
  }

  const body = {
    tx_ref: reference,
    amount: params.amountKobo / 100, // Flutterwave expects major units (e.g. 7500 for ₦7,500)
    currency,
    redirect_url: params.redirectUrl || 'https://matineeapi-production.up.railway.app/api/v1/payments/callback',
    customer: {
      email: params.customerEmail,
      name: params.customerName,
    },
    customizations: {
      title: 'ReelPass Cinema Tickets',
      description: `Payment for booking ${params.bookingReference}`,
      logo: 'https://matineeapi-production.up.railway.app/favicon.ico',
    },
  };

  const fetcher = mockFetch || fetch;
  const res = await fetcher(`${FLUTTERWAVE_BASE}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key || 'mock_secret_key'}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.status !== 'success') {
    throw new Error(`Flutterwave initialization failed: ${json?.message || res.status}`);
  }

  return {
    configured: true,
    link: json.data?.link,
    reference,
    amountKobo: params.amountKobo,
    currency,
  };
}

function toResult(json: any): VerificationResult {
  const data = json?.data;
  if (!data) {
    return { ok: false, reason: json?.message || 'No transaction data returned from gateway' };
  }

  const isSuccess = json.status === 'success' && data.status === 'successful';
  return {
    ok: isSuccess,
    status: data.status,
    amountKobo: typeof data.amount === 'number' ? Math.round(data.amount * 100) : undefined,
    currency: data.currency,
    txRef: data.tx_ref,
    transactionId: data.id !== undefined ? String(data.id) : undefined,
    raw: json,
    reason: isSuccess ? undefined : data.processor_response || json.message || `Transaction status: ${data.status}`,
  };
}

async function flwGet(path: string): Promise<any> {
  const key = secretKey();
  if (!key && !mockFetch) throw new Error('Payment provider is not configured');

  const fetcher = mockFetch || fetch;
  const res = await fetcher(`${FLUTTERWAVE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key || 'mock_secret_key'}` },
  });

  return res.json();
}

/** Verify a payment attempt by Flutterwave transaction ID */
export async function verifyTransactionById(transactionId: string | number): Promise<VerificationResult> {
  try {
    const json = await flwGet(`/transactions/${encodeURIComponent(String(transactionId))}/verify`);
    return toResult(json);
  } catch (err: any) {
    return { ok: false, reason: err.message || 'Failed to verify transaction by ID' };
  }
}

/** Verify a payment attempt by merchant transaction reference (tx_ref) */
export async function verifyTransactionByReference(txRef: string): Promise<VerificationResult> {
  try {
    const json = await flwGet(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
    return toResult(json);
  } catch (err: any) {
    return { ok: false, reason: err.message || 'Failed to verify transaction by reference' };
  }
}
