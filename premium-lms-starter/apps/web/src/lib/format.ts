/** Presentation helpers — pure functions, unit-tested. */

/**
 * Format a server-provided decimal amount with its currency. The server is
 * the price authority; this only renders what the API returned.
 */
export function formatPrice(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(value) ? 2 : undefined,
    }).format(value);
  } catch {
    // Unknown currency codes (placeholder while O-21 remains open).
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Compact duration: "45m", "1h 30m", "2h", or "—" when unknown. */
export function formatDuration(totalSeconds: string | number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return '—';
  const seconds = typeof totalSeconds === 'string' ? Number(totalSeconds) : totalSeconds;
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** Human date for enrolment/order timestamps. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}
