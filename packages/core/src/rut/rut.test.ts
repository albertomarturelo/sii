import { describe, it, expect } from 'vitest';
import { Rut } from './rut.js';
import { ValidationError } from '../errors/index.js';

describe('Rut', () => {
  // Synthetic, Mod-11-valid RUTs only (no real PII).
  it.each(['11111111-1', '12345670-K', '20000042-0', '77.777.777-7'])(
    'parses valid %s',
    (input) => {
      expect(() => Rut.parse(input)).not.toThrow();
    },
  );

  it('canonicalises dotted input', () => {
    expect(Rut.parse('77.777.777-7').canonical).toBe('77777777-7');
  });

  it('formats with thousands separators', () => {
    expect(Rut.parse('77777777-7').formatted).toBe('77.777.777-7');
  });

  it('accepts lowercase k and normalises to K', () => {
    expect(Rut.parse('12345670-k').dv).toBe('K');
  });

  it('rejects a wrong DV', () => {
    expect(() => Rut.parse('11111111-2')).toThrow(ValidationError);
  });

  it('tryParse returns null on garbage', () => {
    expect(Rut.tryParse('not-a-rut')).toBeNull();
  });

  it('equals compares body + dv across formats', () => {
    expect(Rut.parse('20000042-0').equals(Rut.parse('20.000.042-0'))).toBe(true);
  });
});
