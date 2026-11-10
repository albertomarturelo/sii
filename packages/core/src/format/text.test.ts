import { describe, it, expect } from 'vitest';
import { repairMojibake, repairedText } from './text.js';

// Synthetic strings only. `Ã³` is "ó" double-encoded: UTF-8 C3 B3 read back as Latin-1.
describe('repairMojibake (SII double-encoded text)', () => {
  it('repairs a double-encoded string', () => {
    expect(repairMojibake('Has efectuado una DeclaraciÃ³n Rectificatoria')).toBe(
      'Has efectuado una Declaración Rectificatoria',
    );
    expect(repairMojibake('TesorerÃ­a General de la RepÃºblica')).toBe(
      'Tesorería General de la República',
    );
    // F22 terceros' title (observed 2026-10-21) and the borradores' "Ñ" (via U+0091).
    expect(repairMojibake('NÂ° de certificado')).toBe('N° de certificado');
    expect(repairMojibake('Ã\u0091uÃ±oa')).toBe('Ñuñoa');
  });

  it('leaves clean text alone: plain, correctly accented, or with characters above U+00FF', () => {
    expect(repairMojibake('TALLER DEL SUR LTDA')).toBe('TALLER DEL SUR LTDA');
    expect(repairMojibake('Declaración recibida')).toBe('Declaración recibida');
    expect(repairMojibake('DeclaraciÃ³n vigente — aceptada')).toBe(
      'DeclaraciÃ³n vigente — aceptada',
    );
  });

  it('leaves a lone "Ã" or "Â" that does not round-trip as it came', () => {
    expect(repairMojibake('SÃO PAULO')).toBe('SÃO PAULO');
    expect(repairMojibake('Ã³Ã')).toBe('Ã³Ã');
  });

  it('repairedText keeps null and stringifies before repairing', () => {
    expect(repairedText(null)).toBeNull();
    expect(repairedText(undefined)).toBeNull();
    expect(repairedText('autorizÃ³')).toBe('autorizó');
    expect(repairedText(42)).toBe('42');
  });
});
