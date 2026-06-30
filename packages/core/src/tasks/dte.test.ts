import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { DteError } from '../errors/index.js';
import { dteAuthorized } from './dte.js';

// Synthetic data (no SII, no real PII): subject RUT 20.000.042-0.
const SUBJECT = '20000042-0';

const AUTHORIZED_HTML = `
<table>
  <tr><td>Rut</td><td>20.000.042-0</td></tr>
  <tr><td>Razon Social/Nombres</td><td>EMPRESA SINTETICA SPA</td></tr>
  <tr><td>N Resolucion</td><td>80</td></tr>
</table>
<table>
  <tr><td>33</td><td>FACTURA ELECTRONICA</td><td>01-08-2014</td><td></td></tr>
</table>`;
const NOT_AUTHORIZED_HTML =
  '<table><tr><td>El rut que ha ingresado, no corresponde a una empresa autorizada a emitir Facturas Electronicas.</td></tr></table>';

function makeRuntime(driver: FakePortalDriver): Runtime {
  return {
    clock: new FixedClock(new Date('2026-06-29T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: driver,
  };
}
const entries = (rt: Runtime) => (rt.audit as RecordingAuditSink).entries;

describe('dteAuthorized task (fakes, no SII)', () => {
  it('queries the public consulta (no session) and returns the parsed report + audits ok', async () => {
    const driver = new FakePortalDriver({ requestPublic: () => AUTHORIZED_HTML });
    const rt = makeRuntime(driver);

    const res = await dteAuthorized(rt, { rut: SUBJECT });
    expect(res).toMatchObject({ rut: SUBJECT, autorizado: true });
    expect(res.documentos.map((d) => d.codigo)).toEqual([33]);

    // No login involved — it goes straight to the public path.
    expect(driver.requestPublicCalls).toBe(1);
    expect(driver.restoreCalls).toBe(0);

    const a = entries(rt).at(-1)!;
    expect(a).toMatchObject({
      action: 'dte_autorizados',
      result: 'ok',
      rut: SUBJECT,
      autorizado: true,
    });
    expect(a.rutAuth).toBeUndefined(); // public consulta → no authenticated principal
  });

  it('a not-authorized RUT still audits ok (a valid negative, not a failure)', async () => {
    const rt = makeRuntime(new FakePortalDriver({ requestPublic: () => NOT_AUTHORIZED_HTML }));
    const res = await dteAuthorized(rt, { rut: SUBJECT });
    expect(res.autorizado).toBe(false);
    expect(entries(rt).at(-1)).toMatchObject({ result: 'ok', autorizado: false });
  });

  it('a malformed RUT fails fast (Mod-11) with no request issued', async () => {
    const driver = new FakePortalDriver({ requestPublic: () => AUTHORIZED_HTML });
    const rt = makeRuntime(driver);
    await expect(dteAuthorized(rt, { rut: 'not-a-rut' })).rejects.toThrow();
    expect(driver.requestPublicCalls).toBe(0);
  });

  it('a CGI/network failure surfaces as DteError + a failed audit receipt', async () => {
    const rt = makeRuntime(new FakePortalDriver({ failPublic: new Error('ECONNRESET') }));
    await expect(dteAuthorized(rt, { rut: SUBJECT })).rejects.toBeInstanceOf(DteError);
    expect(entries(rt).at(-1)).toMatchObject({
      action: 'dte_autorizados',
      result: 'failed',
      rut: SUBJECT,
    });
  });
});
