import { describe, it, expect } from 'vitest';
import { repairMojibake, repairedText } from './text.js';
import * as core from '../index.js';

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

  it('repairs a cp1252 double encoding: a capital accent whose second byte is 0x80–0x9F (GH-271)', () => {
    // « Ó » is C3 93; SII read 0x93 as cp1252's `“` (U+201C). The « á » beside it is repaired too.
    expect(
      repairMojibake('RESULTADO LIQUIDACI\u00c3\u201cN ANUAL (deber\u00c3\u00a1 declarar)'),
    ).toBe('RESULTADO LIQUIDACIÓN ANUAL (deberá declarar)');
    // « É » C3 89 → `‰`, « Ñ » C3 91 → `‘`, « Ú » C3 9A → `š`, « Á » C3 81 (undefined in cp1252).
    expect(
      repairMojibake('CR\u00c3\u2030DITO A\u00c3\u2018O \u00c3\u0161LTIMO R\u00c3\u0081PIDO'),
    ).toBe('CRÉDITO AÑO ÚLTIMO RÁPIDO');
  });

  it('leaves clean text with cp1252 punctuation alone when it carries no tell-tale pair', () => {
    expect(repairMojibake('Plazo “vigente” – 2025, € 10')).toBe('Plazo “vigente” – 2025, € 10');
    expect(repairMojibake('LIQUIDACIÓN – «deberá»')).toBe('LIQUIDACIÓN – «deberá»');
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

  it('removes one layer per call: text encoded twice over needs a second call (GH-279)', () => {
    // Synthetic: "ó" double-encoded, then double-encoded again. SII was only observed with one layer.
    const twice = 'DeclaraciÃƒÂ³n';
    expect(repairMojibake(twice)).toBe('DeclaraciÃ³n');
    expect(repairMojibake(repairMojibake(twice))).toBe('Declaración');
  });

  it('is idempotent on one layer: a second pass changes nothing (GH-279)', () => {
    // GH-264 / GH-267 (Latin-1 pairs), GH-271 (cp1252 capitals), plus clean and lone-Ã text.
    const cases = [
      'Has efectuado una DeclaraciÃ³n Rectificatoria',
      'TesorerÃ­a General de la RepÃºblica',
      'NÂ° de certificado',
      'Ã\u0091uÃ±oa',
      'RESULTADO LIQUIDACI\u00c3\u201cN ANUAL (deber\u00c3\u00a1 declarar)',
      'CR\u00c3\u2030DITO A\u00c3\u2018O \u00c3\u0161LTIMO R\u00c3\u0081PIDO',
      'LIQUIDACIÓN – «deberá»',
      'SÃO PAULO',
      'Ã³Ã',
    ];
    for (const s of cases) {
      const once = repairMojibake(s);
      expect(repairMojibake(once)).toBe(once);
    }
  });
});

// A consumer repairs text it stored with the package's own function (GH-279).
describe('package index', () => {
  it('exports repairMojibake, the same function the facades apply', () => {
    expect(core.repairMojibake).toBe(repairMojibake);
    expect(core.repairMojibake('TRIBUTACI\u00c3\u201cN')).toBe('TRIBUTACIÓN');
  });

  it('keeps repairedText internal', () => {
    expect('repairedText' in core).toBe(false);
  });
});
