import { describe, it, expect } from 'vitest';
import { parseDatosCntrNow, regimenTributario } from './datos-cntr.js';
import type { DatosCntr } from './datos-cntr.js';

// Synthetic Mi SII HTML: the inline DatosCntrNow literal surrounded by the real page's
// chrome + trailing script (values synthetic — no real PII, ADR-004).
const miSiiHtml = (inner: string): string =>
  `<!doctype html><html><head><title>MISII</title></head><body>
   <script>var DatosCntrNow = ${inner};</script>
   <script>var Otra = { rut: 999 }; function f(){ return {a:1}; }</script>
   </body></html>`;

describe('parseDatosCntrNow', () => {
  it('extracts the balanced object literal, ignoring trailing page script', () => {
    const html = miSiiHtml(
      '{"codigoError":0,"contribuyente":{"rut":11111111,"dv":"1","razonSocial":null,' +
        '"nombres":"Juanita","apellidoPaterno":"Pérez","eMail":"j@example.cl"},"direcciones":[{}]}',
    );
    const datos = parseDatosCntrNow(html);
    expect(datos?.contribuyente?.rut).toBe(11111111);
    expect(datos?.contribuyente?.dv).toBe('1');
    expect(datos?.contribuyente?.nombres).toBe('Juanita');
    expect(datos?.contribuyente?.eMail).toBe('j@example.cl');
  });

  it('handles a brace inside a string value without breaking the balance', () => {
    const datos = parseDatosCntrNow(
      miSiiHtml('{"contribuyente":{"rut":"12","dv":"3","nombres":"A {B} C"}}'),
    );
    expect(datos?.contribuyente?.nombres).toBe('A {B} C');
    expect(datos?.contribuyente?.dv).toBe('3');
  });

  it('returns null when the object is absent (dead session bounced to the login page)', () => {
    expect(parseDatosCntrNow('<html><body>Ingreso Mi SII — zeusr login</body></html>')).toBeNull();
  });

  it('reads the atributos codes, and a changed atributos shape never costs the identity (#208)', () => {
    const datos = parseDatosCntrNow(
      miSiiHtml(
        '{"contribuyente":{"rut":11111111,"dv":"1"},"atributos":[{"rut":11111111,"dv":"1",' +
          '"atrCodigo":"14D1","fechaInicio":"01-03-2026","fechaTermino":null,"eliminado":null}]}',
      ),
    );
    expect(datos?.atributos?.[0]?.atrCodigo).toBe('14D1');
    const changed = parseDatosCntrNow(
      miSiiHtml('{"contribuyente":{"rut":11111111,"dv":"1"},"atributos":"otra forma"}'),
    );
    expect(changed?.contribuyente?.rut).toBe(11111111);
    expect(changed?.atributos).toBeNull();
  });

  it('a non-string alertas field loses that field, never the identity (#214)', () => {
    for (const [campo, valor] of [
      ['fechaInicioActividades', 1577836800000],
      ['fechaInicioActividades', { fecha: '2020-01-01' }],
      ['fechaTerminoGiro', 1577836800000],
      ['autorizadoDeclararDia20', false],
    ] as const) {
      const datos = parseDatosCntrNow(
        miSiiHtml(
          JSON.stringify({
            contribuyente: { rut: 11111111, dv: '1', nombres: 'A', [campo]: valor },
          }),
        ),
      );
      expect(datos?.contribuyente?.rut).toBe(11111111);
      expect(datos?.contribuyente?.nombres).toBe('A');
      expect(datos?.contribuyente?.[campo]).toBeNull();
    }
  });

  it('returns null on an unbalanced / unparseable literal rather than throwing', () => {
    expect(parseDatosCntrNow('<script>var DatosCntrNow = {oops</script>')).toBeNull();
  });
});

describe('regimenTributario (#257) — shared by alertas and whoami', () => {
  const d = (contribuyente: Record<string, unknown>, atributos?: unknown): DatosCntr =>
    parseDatosCntrNow(
      miSiiHtml(
        JSON.stringify({
          contribuyente: { rut: 1, dv: '9', ...contribuyente },
          ...(atributos !== undefined && { atributos }),
        }),
      ),
    ) as DatosCntr;
  const regimen14D = (fechaInicio: string, extra: Record<string, unknown> = {}) => ({
    atrCodigo: '14D1',
    fechaInicio,
    fechaTermino: null,
    eliminado: null,
    ...extra,
  });

  it('no DatosCntrNow at all: every field unknown', () => {
    expect(regimenTributario(null)).toEqual({
      inicioActividades: null,
      terminoGiro: null,
      obligadoF29Desde: null,
      segundaCategoria: null,
      diaF29: null,
    });
  });

  it('obligadoF29Desde is the later of the inicio and the regime start', () => {
    const inicio = { fechaInicioActividades: '2026-03-26 00:00:00.0' };
    expect(regimenTributario(d(inicio, [regimen14D('01-05-2026')])).obligadoF29Desde).toBe(
      '2026-05',
    );
    expect(regimenTributario(d(inicio, [regimen14D('01-01-2020')])).obligadoF29Desde).toBe(
      '2026-03',
    );
  });

  it('no obligation without an inicio, with an ended or deleted regime, or an unparseable start', () => {
    const inicio = { fechaInicioActividades: '2026-03-26 00:00:00.0' };
    expect(regimenTributario(d({}, [regimen14D('01-05-2026')])).obligadoF29Desde).toBeNull();
    const ended = regimen14D('01-05-2026', { fechaTermino: '01-06-2026' });
    expect(regimenTributario(d(inicio, [ended])).obligadoF29Desde).toBeNull();
    expect(regimenTributario(d(inicio, [ended])).segundaCategoria).toBeNull();
    const deleted = regimen14D('01-05-2026', { eliminado: 'S' });
    expect(regimenTributario(d(inicio, [deleted])).obligadoF29Desde).toBeNull();
    expect(regimenTributario(d(inicio, [regimen14D('2026-05-01')])).obligadoF29Desde).toBeNull();
    // One start that parses and one that does not: no proof of when it began.
    const both = [regimen14D('01-05-2026'), regimen14D('??')];
    expect(regimenTributario(d(inicio, both)).obligadoF29Desde).toBeNull();
  });

  it('segundaCategoria: SGPE category 2 is true, « = 1 y 2 » and an ended SGPE are unknown', () => {
    const sgpe = (valor: string, extra: Record<string, unknown> = {}) => [
      { atrCodigo: 'SGPE', fechaInicio: '01-01-2020', valor, ...extra },
    ];
    const cat2 = 'Tipo contribuyente=1 y Categoría Contribuyente = 2';
    expect(regimenTributario(d({}, sgpe(cat2))).segundaCategoria).toBe(true);
    expect(
      regimenTributario(d({}, sgpe('Tipo contribuyente=1 y Categoría Contribuyente = 1 y 2')))
        .segundaCategoria,
    ).toBeNull();
    expect(
      regimenTributario(d({}, sgpe(cat2, { fechaTermino: '01-01-2021' }))).segundaCategoria,
    ).toBeNull();
    // A primera-categoría regime in force wins: it is a proven « no ».
    expect(
      regimenTributario(d({}, [...sgpe(cat2), regimen14D('01-01-2021')])).segundaCategoria,
    ).toBe(false);
    // Read but holding neither: unknown.
    expect(
      regimenTributario(d({}, [{ atrCodigo: 'NOTI', valor: 'x@example.cl' }])).segundaCategoria,
    ).toBeNull();
  });

  it('diaF29 reads "S" / "N" and leaves anything else unknown', () => {
    expect(regimenTributario(d({ autorizadoDeclararDia20: 'S' })).diaF29).toBe(20);
    expect(regimenTributario(d({ autorizadoDeclararDia20: ' n ' })).diaF29).toBe(12);
    expect(regimenTributario(d({ autorizadoDeclararDia20: 'X' })).diaF29).toBeNull();
    expect(regimenTributario(d({ autorizadoDeclararDia20: 20 })).diaF29).toBeNull(); // .catch(null)
  });

  it('an impossible or odd date reads null and never throws (#214)', () => {
    const r = regimenTributario(
      d({ fechaInicioActividades: '2026-13-40 00:00:00.0', fechaTerminoGiro: 12345 }, [
        regimen14D('31-02-2026'),
      ]),
    );
    expect(r.inicioActividades).toBeNull();
    expect(r.terminoGiro).toBeNull();
    expect(r.obligadoF29Desde).toBeNull();
  });
});
