import crypto from 'node:crypto';
import { env } from '../config/env';

const base = 'https://api.flutterwave.com/v3';
type FetchMock = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
let mockFetch: FetchMock | null = null;

let mockSandboxMode: boolean | null = null;

export function setFlutterwaveMock(handler: FetchMock | null, isSandbox: boolean | null = null) {
  if (env.NODE_ENV !== 'test') throw new Error('Gateway mocks are test-only');
  mockFetch = handler;
  mockSandboxMode = isSandbox;
}

function sandboxKey() {
  const key = (env.FLW_SECRET_KEY || env.FLUTTERWAVE_SECRET_KEY || '').trim();
  return /^FLWSECK_TEST-[a-z0-9_-]+$/i.test(key) && !/xxxx|placeholder|^FLWSECK_TEST-your-/i.test(key) ? key : null;
}

export function isSandboxMode(): boolean {
  if (mockSandboxMode !== null) return mockSandboxMode;
  if (sandboxKey() !== null) return true;
  const rawKey = (env.FLW_SECRET_KEY || env.FLUTTERWAVE_SECRET_KEY || process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY || '').trim();
  if (/^FLWSECK_TEST-/i.test(rawKey)) return true;
  return process.env.FLW_SANDBOX === 'true' || process.env.FLUTTERWAVE_SANDBOX === 'true';
}

export const isPaymentConfigured = () => Boolean(sandboxKey() || mockFetch);
export const getPaymentCurrency = () => env.FLW_CURRENCY.toUpperCase();

function webhookSecret() {
  const hash = (env.FLW_SECRET_HASH || env.FLUTTERWAVE_WEBHOOK_SECRET_HASH || '').trim();
  return hash && !/xxxx|placeholder|^your-/i.test(hash) ? hash : '';
}
export const isWebhookConfigured = () => Boolean(webhookSecret());

export function verifyWebhookSignature(header: string | undefined): boolean {
  const secret = webhookSecret();
  if (!secret || !header) return false;
  // Hashing both values gives equal-length buffers without exposing either value.
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(header), digest(secret));
}

export class GatewayError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function request(path: string, body?: object) {
  const key = sandboxKey();
  if (!key && !mockFetch) throw new GatewayError('SANDBOX_NOT_CONFIGURED');
  let response;
  try {
    response = await (mockFetch || fetch)(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + (key || 'test-mock'), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
  } catch {
    throw new GatewayError('GATEWAY_UNREACHABLE');
  }
  if (!response.ok) throw new GatewayError('GATEWAY_HTTP_' + response.status);
  const json = await response.json().catch(() => null) as { status?: unknown; data?: unknown } | null;
  if (json?.status !== 'success' || json.data == null) throw new GatewayError('GATEWAY_INVALID_RESPONSE');
  return json.data;
}

export function minorUnits(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 1e-6 ? rounded : undefined;
}

export function providerId(value: unknown): string | undefined {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const id = String(value);
  return /^[1-9][0-9]{0,19}$/.test(id) ? id : undefined;
}

export const VERIFIED_FLUTTERWAVE_HOSTS: ReadonlySet<string> = new Set([
  'checkout.flutterwave.com',
  'checkout-v3.flutterwave.com',
  'flutterwave.com',
]);

export const VERIFIED_SANDBOX_FLUTTERWAVE_HOSTS: ReadonlySet<string> = new Set([
  ...VERIFIED_FLUTTERWAVE_HOSTS,
  'checkout-v2.dev-flutterwave.com',
]);

export function isLegitimateFlutterwaveCheckoutUrl(
  url: URL,
  sandbox: boolean = isSandboxMode()
): boolean {
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const allowlist = sandbox ? VERIFIED_SANDBOX_FLUTTERWAVE_HOSTS : VERIFIED_FLUTTERWAVE_HOSTS;
  return allowlist.has(url.hostname.toLowerCase());
}

export async function initializePayment(input: {
  reference: string; amountKobo: number; currency: string; email: string; name: string;
}) {
  const data = await request('/payments', {
    tx_ref: input.reference,
    amount: input.amountKobo / 100,
    currency: input.currency,
    redirect_url: env.FLW_CALLBACK_URL,
    customer: { email: input.email, name: input.name },
    customizations: { title: 'ReelPass Cinema Tickets' },
  }) as { link?: unknown };

  const responseShape = typeof data === 'object' && data !== null ? Object.keys(data as object).sort() : typeof data;

  if (typeof data?.link !== 'string') {
    console.warn(JSON.stringify({
      event: 'checkout_link_diagnostic',
      responseShape,
      protocol: undefined,
      hostname: undefined,
      error: 'missing_or_invalid_link_type',
    }));
    throw new GatewayError('GATEWAY_INVALID_CHECKOUT_LINK');
  }

  let url: URL;
  try {
    url = new URL(data.link.trim());
  } catch {
    console.warn(JSON.stringify({
      event: 'checkout_link_diagnostic',
      responseShape,
      protocol: undefined,
      hostname: undefined,
      error: 'malformed_url',
    }));
    throw new GatewayError('GATEWAY_INVALID_CHECKOUT_LINK');
  }

  const hostname = url.hostname.toLowerCase();
  const protocol = url.protocol;

  console.info(JSON.stringify({
    event: 'checkout_link_diagnostic',
    responseShape,
    protocol,
    hostname,
  }));

  if (!isLegitimateFlutterwaveCheckoutUrl(url)) {
    console.warn(JSON.stringify({
      event: 'checkout_link_rejected',
      responseShape,
      protocol,
      hostname,
      reason: 'unauthorized_checkout_url',
    }));
    throw new GatewayError('GATEWAY_INVALID_CHECKOUT_LINK');
  }

  return url.href;
}

export interface VerifiedTransaction {
  transactionId?: string;
  reference?: string;
  amountKobo?: number;
  currency?: string;
  status?: string;
}

export async function verifyTransactionById(id: string): Promise<VerifiedTransaction> {
  const data = await request('/transactions/' + encodeURIComponent(id) + '/verify') as Record<string, unknown>;
  return {
    transactionId: providerId(data.id),
    reference: typeof data.tx_ref === 'string' ? data.tx_ref : undefined,
    amountKobo: minorUnits(data.amount),
    currency: typeof data.currency === 'string' ? data.currency : undefined,
    status: typeof data.status === 'string' ? data.status : undefined,
  };
}

function parseRefund(data: Record<string, unknown>) {
  const id = providerId(data.id);
  const transactionId = providerId(data.tx_id ?? data.transaction_id ?? data.TransactionId);
  const amountKobo = minorUnits(data.amount_refunded ?? data.AmountRefunded);
  const status = typeof data.status === 'string' ? data.status : '';
  if (!id || !transactionId || !amountKobo || !status) throw new GatewayError('GATEWAY_INVALID_REFUND');
  return { id, transactionId, amountKobo, status };
}

export async function requestRefund(transactionId: string, amountKobo: number, refundId: string) {
  return parseRefund(await request('/transactions/' + encodeURIComponent(transactionId) + '/refund', {
    amount: amountKobo / 100,
    comments: 'ReelPass refund ' + refundId,
  }) as Record<string, unknown>);
}

export async function fetchRefund(refundId: string) {
  const refund = parseRefund(await request('/refunds/' + encodeURIComponent(refundId)) as Record<string, unknown>);
  if (refund.id !== refundId) throw new GatewayError('REFUND_PROVIDER_MISMATCH');
  return refund;
}

export async function listRefunds(transactionId: string) {
  const query = new URLSearchParams({
    id: transactionId, from: '2020-01-01', to: new Date().toISOString().slice(0, 10),
  });
  const data = await request('/refunds?' + query);
  if (!Array.isArray(data)) throw new GatewayError('GATEWAY_INVALID_REFUND_LIST');
  return data.map(parseRefund).filter((refund) => refund.transactionId === transactionId);
}
