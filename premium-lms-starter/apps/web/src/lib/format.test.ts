import { describe, expect, it } from 'vitest';
import { formatDuration, formatDate, formatPrice } from './format.js';

describe('formatPrice', () => {
  it('formats NGN amounts from the server as currency', () => {
    const formatted = formatPrice('25000.00', 'NGN');
    expect(formatted).toContain('25,000');
    expect(formatted).toMatch(/₦|NGN/);
  });

  it('keeps decimals for non-integer amounts', () => {
    expect(formatPrice('99.50', 'USD')).toContain('99.50');
  });

  it('keeps the currency code visible for unknown/placeholder currencies', () => {
    // Well-formed but unassigned codes (placeholder currencies while O-21
    // is open) still render with the code and amount intact.
    const formatted = formatPrice('10.00', 'XYZ');
    expect(formatted).toContain('XYZ');
    expect(formatted).toContain('10.00');
  });

  it('falls back to a plain string when the currency code is malformed', () => {
    expect(formatPrice('10.00', 'DOLLARS')).toBe('10.00 DOLLARS');
  });

  it('never invents a number for malformed input', () => {
    expect(formatPrice('not-a-price', 'NGN')).toBe('not-a-price NGN');
  });
});

describe('formatDuration', () => {
  it('renders minutes, hours and combinations', () => {
    expect(formatDuration(45 * 60)).toBe('45m');
    expect(formatDuration(120 * 60)).toBe('2h');
    expect(formatDuration(150 * 60)).toBe('2h 30m');
    expect(formatDuration('900')).toBe('15m');
  });

  it('returns an em dash for missing or invalid values', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration('abc')).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats ISO timestamps', () => {
    expect(formatDate('2026-01-15T00:00:00.000Z')).not.toBe('—');
  });

  it('handles missing and invalid values', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});
