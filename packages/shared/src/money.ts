// ReelPass money utilities.
//
// All monetary values are stored and transported as INTEGER KOBO (1 NGN = 100 kobo).
// This keeps financial arithmetic exact (no floating point drift) and keeps a single
// conversion boundary: format at the edge, calculate in kobo.

export const NAIRA_CURRENCY_CODE = 'NGN' as const;
export const NAIRA_SYMBOL = '\u20A6'; // ₦
export const NAIRA_LOCALE = 'en-NG' as const;
export const KOBO_PER_NAIRA = 100;

/** Convert an integer kobo amount to a naira number (may be fractional). */
export function koboToNaira(kobo: number): number {
  return Math.round(kobo) / KOBO_PER_NAIRA;
}

/** Convert a naira amount to integer kobo. */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * KOBO_PER_NAIRA);
}

/**
 * Format an integer kobo amount as Nigerian naira, e.g. 450000 -> "₦4,500".
 * Uses `Intl.NumberFormat('en-NG', ...)` where supported (Hermes/JSC/Node),
 * with a dependency-free fallback for engines without the NGN locale data.
 */
export function formatNaira(kobo: number): string {
  const naira = koboToNaira(kobo);
  try {
    return new Intl.NumberFormat(NAIRA_LOCALE, {
      style: 'currency',
      currency: NAIRA_CURRENCY_CODE,
      maximumFractionDigits: 0,
    }).format(naira);
  } catch {
    const rounded = Math.round(naira);
    const grouped = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${NAIRA_SYMBOL}${grouped}`;
  }
}

/** Sum a list of integer kobo amounts. */
export function sumKobo(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + Math.round(amount), 0);
}
