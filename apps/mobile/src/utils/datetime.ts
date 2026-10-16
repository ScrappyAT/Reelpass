// Nigerian (Africa/Lagos) date & time helpers used across ReelPass.
// All showtimes are stored as ISO instants; we always DISPLAY them in Lagos time.

export const LAGOS_TIME_ZONE = 'Africa/Lagos';

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let formatter = timeFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-NG', { ...options, timeZone: LAGOS_TIME_ZONE });
    timeFormatterCache.set(key, formatter);
  }
  return formatter;
}

/** "19:30" — 24-hour Lagos time for a showtime instant. */
export function formatShowtimeTime(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return getFormatter('time', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** "Sat, 17 Oct" — Lagos calendar date for a showtime instant. */
export function formatShowtimeDate(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return getFormatter('date', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}

/** "2026-10-15" — Lagos calendar day key for grouping/filtering showtimes. */
export function getLagosDateKey(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  // en-CA formats dates as YYYY-MM-DD regardless of region.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LAGOS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export interface DateChip {
  /** Lagos day key "YYYY-MM-DD" used for filtering. */
  id: string;
  label: string;
  sublabel: string;
}

/**
 * Build the next `count` day chips (Today, Tomorrow, then weekday names),
 * labelled in Lagos time. IDs are Lagos day keys usable for filtering.
 */
export function buildLagosDateChips(count = 4): DateChip[] {
  const labels = ['Today', 'Tomorrow'];
  const chips: DateChip[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const instant = new Date(now + i * 24 * 60 * 60 * 1000);
    const id = getLagosDateKey(instant);
    const label =
      labels[i] ||
      getFormatter(`wd-${i}`, { weekday: 'long' }).format(instant);
    const sublabel = getFormatter(`sd-${i}`, { day: 'numeric', month: 'short' }).format(instant);
    chips.push({ id, label, sublabel });
  }

  return chips;
}
