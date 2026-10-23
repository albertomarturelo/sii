import { describe, it, expect } from 'vitest';
import { parseDatosCntrNow } from './datos-cntr.js';

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

  it('returns null on an unbalanced / unparseable literal rather than throwing', () => {
    expect(parseDatosCntrNow('<script>var DatosCntrNow = {oops</script>')).toBeNull();
  });
});
