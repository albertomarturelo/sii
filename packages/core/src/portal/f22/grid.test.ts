import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../../adapters/fake/index.js';
import { Rut } from '../../rut/index.js';
import { Anio } from '../../periodo/index.js';
import { fetchF22Grid, groupCodigos } from './index.js';
import type { CodigoF22 } from './index.js';

// Synthetic data only (no real PII, no SII): operating 77.777.777-7, año 2025.
const RUT = Rut.parse('77777777-7');
const ANIO = Anio.parse('2025');

const session = (requestJson: (url: string, options?: unknown) => unknown): FakePortalSession =>
  new FakePortalSession({ requestJson, cookies: { TOKEN: 'conv' } });

const reqBody = (s: FakePortalSession): Record<string, unknown> =>
  (s.lastRequest?.options?.body as { data: Record<string, unknown> }).data;

describe('F22 grid facade (fake session, synthetic envelopes, no SII)', () => {
  it('f22Compacto: curates tax códigos, EXCLUDES identity/bank PII (incl. 8809/9306/9920), sends folio', async () => {
    const s = session(() => ({
      metaData: {},
      data: [
        { codigo: '305', valor: '-150000', glosa: 'RESULTADO LIQUIDACIÓN ANUAL' },
        { codigo: '87', valor: '150000', glosa: 'Monto devolución solicitada' },
        { codigo: '110', valor: '3000000', glosa: 'Rentas honorarios art 42 N°2' }, // tax → kept
        { codigo: '3', valor: '77777777-7', glosa: 'RUT' }, // header PII → dropped
        { codigo: '55', valor: 'pii@example.cl', glosa: 'Email' }, // identity PII → dropped
        { codigo: '306', valor: '000999888', glosa: 'Número de Cuenta' }, // bank → dropped
        { codigo: '8809', valor: '777777777', glosa: '' }, // RUT-as-integer (MF3) → dropped
        { codigo: '9920', valor: 'CALLE FALSA 123', glosa: 'Dirección Origen' }, // address → dropped
      ],
    }));

    const codigos = await fetchF22Grid(s, { rut: RUT, anio: ANIO, folio: '12345' });

    expect(codigos.map((c) => c.codigo).sort()).toEqual(['110', '305', '87']);
    expect(codigos.find((c) => c.codigo === '305')?.valor).toBe(-150000); // sign preserved
    // No identity/bank PII reaches the curated grid — incl. the RUT-as-integer 8809.
    const dump = JSON.stringify(codigos);
    expect(dump).not.toContain('77777777-7');
    expect(dump).not.toContain('777777777'); // 8809's bare-integer RUT
    expect(dump).not.toContain('pii@example.cl');
    expect(dump).not.toContain('000999888');
    expect(dump).not.toContain('CALLE FALSA 123');
    expect(reqBody(s)).toMatchObject({ folio: '12345', periodo: '2025', rut: '77777777', dv: '7' });
  });

  it('f22Compacto: parses es-CL montos (dot=thousands) — millions and singles alike', async () => {
    // SII serves montos in Chilean format. Number() would make "9.999" → 9.999 and
    // "12.345.678" → NaN (two dots) → null → "—". The parser must strip thousands dots.
    // (Synthetic values — never a real declaration's montos.)
    const s = session(() => ({
      metaData: {},
      data: [
        { codigo: '1098', valor: '12.345.678', glosa: 'Sueldos' }, // millions (two dots) → 12345678
        { codigo: '90', valor: '9.999', glosa: 'Impuesto Adeudado' }, // thousands (one dot) → 9999
        { codigo: '305', valor: '-150.000', glosa: 'Resultado' }, // negative thousands
        { codigo: '87', valor: '1.234.567,50', glosa: 'Devolución' }, // decimal comma
        { codigo: '39', valor: '177', glosa: 'Reajuste' }, // plain integer, unchanged
      ],
    }));

    const codigos = await fetchF22Grid(s, { rut: RUT, anio: ANIO, folio: '12345' });
    const val = (c: string) => codigos.find((x) => x.codigo === c)?.valor;
    expect(val('1098')).toBe(12_345_678); // was NaN→null (shown as "—") before the fix
    expect(val('90')).toBe(9_999); // was 9.999 before the fix
    expect(val('305')).toBe(-150_000);
    expect(val('87')).toBe(1_234_567.5);
    expect(val('39')).toBe(177);
  });

  it('groupCodigos organizes into ingresos/deducciones/créditos/cálculo/resultado; unmapped non-PII → otros', () => {
    const codigos: CodigoF22[] = [
      { codigo: '110', valor: 3_000_000, glosa: 'Rentas honorarios' }, // ingreso
      { codigo: '547', valor: 3_000_000, glosa: 'Total Ingresos Brutos' }, // ingreso
      { codigo: '494', valor: 900_000, glosa: 'Gastos presuntos' }, // deducción
      { codigo: '900', valor: 200_000, glosa: 'Cotizaciones previsionales' }, // deducción
      { codigo: '198', valor: 300_000, glosa: 'Retenciones' }, // retención
      { codigo: '162', valor: 120_000, glosa: 'Crédito al IGC' }, // crédito
      { codigo: '157', valor: 500_000, glosa: 'IGC según tabla' }, // cálculo intermedio
      { codigo: '158', valor: 380_000, glosa: 'SUB TOTAL' }, // cálculo intermedio (#28: NOT resultado)
      { codigo: '304', valor: 380_000, glosa: 'Débito fiscal' }, // cálculo intermedio
      { codigo: '305', valor: -150_000, glosa: 'Resultado' }, // resultado FINAL
      { codigo: '8865', valor: 1, glosa: 'Código Emisión' }, // unclassified non-PII → otros
    ];
    const g = groupCodigos(codigos);
    expect(g.ingresos.map((c) => c.codigo)).toEqual(['110', '547']);
    expect(g.deducciones.map((c) => c.codigo)).toEqual(['494', '900']);
    expect(g.creditos.map((c) => c.codigo)).toEqual(['198', '162']);
    // 157/158/304 are intermediate IGC steps → `calculo`, NOT `resultado` (#28 review).
    expect(g.calculo.map((c) => c.codigo)).toEqual(['157', '158', '304']);
    expect(g.resultado.map((c) => c.codigo)).toEqual(['305']); // only the final outcome
    expect(g.otros.map((c) => c.codigo)).toEqual(['8865']); // surfaced, not hidden
  });
});
