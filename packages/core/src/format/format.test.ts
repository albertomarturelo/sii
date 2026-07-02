import { describe, expect, it } from 'vitest';
import { formatMoney, formatRut } from './format.js';
import { ValidationError } from '../errors/index.js';

describe('formatMoney', () => {
  it('groups thousands es-CL style', () => {
    expect(formatMoney(12345678)).toBe('12.345.678');
    expect(formatMoney(0)).toBe('0');
    expect(formatMoney(-880000)).toBe('-880.000');
  });

  it('renders a missing value as an em dash', () => {
    expect(formatMoney(null)).toBe('—');
  });
});

describe('formatRut', () => {
  it('renders a canonical RUT with dots + DV', () => {
    // Synthetic Mod-11-valid RUT (no real PII).
    expect(formatRut('76192083-9')).toBe('76.192.083-9');
  });

  it('propagates the Rut primitive validation on a malformed input', () => {
    expect(() => formatRut('no-es-un-rut')).toThrow(ValidationError);
  });
});
