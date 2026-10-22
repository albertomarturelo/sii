// A PRIVATE check of the F29 submit chain (#161) against a real filing capture (spike #138). The
// capture carries an empresa's data, so it lives outside the repo; this suite runs only when
// SII_F29_CAPTURES points at a capture's `bodies/` directory, and is skipped otherwise. It drives
// the chain with a caller that answers from the capture, and asserts that every request the
// chain builds is byte for byte the browser's. It asserts equality and códigos only, never values.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import { Gwt7Codec, type Gwt7Call, type Gwt7Node, parseGwtPermutation } from './gwt.js';
import {
  type RfiCaller,
  guardarBorradorF29,
  inyectarBorradorF29,
  validarBorradorF29,
  verificarBorradorF29,
} from './f29-rfi.js';
import { RFI_READ_LAYOUT, RFI_WRITE_LAYOUT } from './rfi-schema.js';

const dir = process.env['SII_F29_CAPTURES'];

// The class each chain method answers with, to pair a response with its request.
const RETURNS: Record<string, string | null> = {
  consultarHijoToken: 'java.util.HashMap',
  getContribuyente: 'cl.sii.sdi.dim.rfi.web.client.to.ResultadoRecuperarContribuyenteTo',
  findAllFormulario: '[Lcl.sii.sdi.dim.rfi.to.Formulario;',
  findPeriodoHabilitado: '[Lcl.sii.sdi.dim.rfi.to.Periodo;',
  findVersionBorradorById: 'cl.sii.sdi.difm.rcs.web.client.to.FormularioLayoutTO',
  crearHijoToken: null,
  getBorradorRfiValidado: 'cl.sii.sdi.dim.rfi.to.BorradorRfi',
  guardarBorradorRfiValidado: 'cl.sii.sdi.dim.rfi.to.Borrador',
  inyectarBorradorRfi: 'java.lang.Boolean',
};
class Blocked extends Error {}

describe.skipIf(!dir)('the F29 submit chain against a private capture', () => {
  it("builds the browser's exact requests and finds no disagreement", async () => {
    const files = readdirSync(dir!).sort((a, b) => parseInt(a) - parseInt(b));
    const read = (f: string): string => readFileSync(join(dir!, f), 'utf8');
    const permFile = files.find(
      (f) => f.endsWith('.res.txt') && read(f).includes("strongName = '"),
    );
    const codec = new Gwt7Codec(
      { write: RFI_WRITE_LAYOUT, read: RFI_READ_LAYOUT },
      parseGwtPermutation('capture', permFile ? read(permFile) : '').sigs,
      (m) => new Error(m),
    );
    const requests = files
      .filter((f) => f.endsWith('.req.txt') && read(f).startsWith('7|'))
      .map((f) => ({ id: parseInt(f), text: read(f), call: codec.decodeRequest(read(f)) }));
    const responses = files
      .filter((f) => f.endsWith('.res.txt') && read(f).startsWith('//OK'))
      .map((f) => ({ id: parseInt(f), text: read(f) }));
    const decodeAs = (text: string, cls: string): Gwt7Node | null => {
      try {
        const v = codec.decodeResponse(text) as Gwt7Node;
        return v?.cls === cls ? v : null;
      } catch {
        return null;
      }
    };

    // The last flow of the capture: from its last consultarHijoToken on.
    let cursor = requests.findLastIndex((r) => r.call.method === 'consultarHijoToken') - 1;
    const used = new Set<number>();
    const call: RfiCaller = (method, params) => {
      const i = requests.findIndex((r, k) => k > cursor && r.call.method === method);
      expect(i, method).toBeGreaterThan(-1);
      cursor = i;
      const captured = requests[i]!;
      const built = codec.encodeRequest({ ...(captured.call as Gwt7Call), params });
      expect(built === captured.text, `${method} byte for byte`).toBe(true);
      const cls = RETURNS[method];
      if (cls === undefined) throw new Error(`método inesperado ${method}`);
      if (cls === null) return Promise.resolve(null);
      const res = responses.find(
        (r) => r.id > captured.id && !used.has(r.id) && decodeAs(r.text, cls) !== null,
      );
      if (res === undefined) throw new Blocked(method); // the capture blocked this call
      used.add(res.id);
      return Promise.resolve(decodeAs(res.text, cls));
    };

    // Who and when, from the flow itself.
    const hijoReq = requests[cursor + 1]!;
    const hijo = responses.find(
      (r) => r.id > hijoReq.id && decodeAs(r.text, 'java.util.HashMap') !== null,
    )!;
    const pairs = (decodeAs(hijo.text, 'java.util.HashMap')!.values[0] as Gwt7Node[][]).map(
      ([k, v]) => [k!.values[0], v!.values[0]] as const,
    );
    const get = (k: string): string => String(pairs.find(([key]) => key === k)![1]);
    const rut = Rut.parse(`${get('rut')}-${get('dv')}`);
    const periodo = Periodo.parse(get('periodo'));

    const propuestaFile = files
      .filter((f) => f.endsWith('.res.txt') && parseInt(f) < hijoReq.id)
      .reverse()
      .find((f) => read(f).includes('"listCodPropuestos"'));
    const propuesta = (
      JSON.parse(read(propuestaFile!)) as {
        data: { listCodPropuestos: { codigo: string; valor: string }[] };
      }
    ).data.listCodPropuestos.map((c) => ({ codigo: c.codigo, valor: Number(c.valor) }));

    const validado = await validarBorradorF29(call, {
      rut,
      periodo,
      hoy: new Date('2026-10-18T21:00:00-03:00'),
    });
    expect(verificarBorradorF29(propuesta, validado.campos, validado.declarados)).toEqual([]);

    // guardar was blocked in run5 and sent in run6; inyectar filed 2026-09 in run6.
    try {
      const guardado = await guardarBorradorF29(call, validado.borrador);
      await inyectarBorradorF29(call, guardado);
    } catch (e) {
      if (!(e instanceof Blocked)) throw e;
    }
  });
});
