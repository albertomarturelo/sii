import { describe, it, expect } from 'vitest';
import { FakePortalDriver } from '../adapters/fake/index.js';
import { Rut } from '../rut/index.js';
import { DteError } from '../errors/index.js';
import { fetchDteAutorizados } from './dte-public.js';

// Synthetic data only (no real PII, no SII): subject RUT 20.000.042-0.
const RUT = Rut.parse('20000042-0');

// A synthetic authorized report: header table (label/value) + docs grid (codigo first).
// `&oacute;` exercises the entity decoder; the docs header row ("Código …") is non-numeric
// and must be ignored. 61 carries a desautorización date; 33/34 are currently authorized.
const AUTHORIZED_HTML = `
<html><body>
<table border="1">
  <tr><td>Rut</td><td>20.000.042-0</td></tr>
  <tr><td>Raz&oacute;n Social/Nombres</td><td>EMPRESA SINT&Eacute;TICA SPA</td></tr>
  <tr><td>N&#176; Resoluci&oacute;n</td><td>80</td></tr>
  <tr><td>Fecha Resoluci&oacute;n</td><td>01-08-2014</td></tr>
  <tr><td>Direcci&oacute;n Regional</td><td>XV DIRECCION REGIONAL METROPOLITANA</td></tr>
</table>
<table border="1">
  <tr><td>C&oacute;digo</td><td>Descripci&oacute;n</td><td>Autorizado</td><td>Desautorizado</td></tr>
  <tr><td>33</td><td>FACTURA ELECTRONICA</td><td>01-08-2014</td><td></td></tr>
  <tr><td>34</td><td>FACTURA NO AFECTA O EXENTA ELECTRONICA</td><td>01-08-2014</td><td></td></tr>
  <tr><td>61</td><td>NOTA CREDITO ELECTRONICA</td><td>01-08-2014</td><td>15-01-2020</td></tr>
</table>
</body></html>`;

const NOT_AUTHORIZED_HTML = `
<html><body>
<table><tr><td>El rut que ha ingresado, no corresponde a una empresa autorizada a emitir Facturas Electronicas.</td></tr></table>
</body></html>`;

const driverWith = (requestPublic: () => string): FakePortalDriver =>
  new FakePortalDriver({ requestPublic });

describe('DTE public facade (fake driver, synthetic HTML, no SII)', () => {
  it('parses the authorized report header + docs grid and sends RUT_EMP/DV_EMP', async () => {
    const driver = driverWith(() => AUTHORIZED_HTML);

    const res = await fetchDteAutorizados(driver, RUT);

    expect(res).toMatchObject({
      rut: '20000042-0',
      autorizado: true,
      razonSocial: 'EMPRESA SINTÉTICA SPA', // entities decoded (&Eacute; → É)
      nResolucion: '80',
      fechaResolucion: '01-08-2014',
      direccionRegional: 'XV DIRECCION REGIONAL METROPOLITANA',
      mensaje: null,
    });
    expect(res.documentos).toEqual([
      {
        codigo: 33,
        descripcion: 'FACTURA ELECTRONICA',
        fechaAutorizacion: '01-08-2014',
        fechaDesautorizacion: null,
      },
      {
        codigo: 34,
        descripcion: 'FACTURA NO AFECTA O EXENTA ELECTRONICA',
        fechaAutorizacion: '01-08-2014',
        fechaDesautorizacion: null,
      },
      {
        codigo: 61,
        descripcion: 'NOTA CREDITO ELECTRONICA',
        fechaAutorizacion: '01-08-2014',
        fechaDesautorizacion: '15-01-2020',
      },
    ]);
    // Body carries the subject RUT split into the observed CGI form fields.
    expect(driver.lastPublicRequest?.options?.form).toEqual({ RUT_EMP: '20000042', DV_EMP: '0' });
    expect(driver.lastPublicRequest?.url).toContain('/cvc_cgi/dte/ee_empresa_rut');
  });

  it('a non-emisor RUT is a clean negative (autorizado:false + verbatim message), not an error', async () => {
    const res = await fetchDteAutorizados(
      driverWith(() => NOT_AUTHORIZED_HTML),
      RUT,
    );
    expect(res.autorizado).toBe(false);
    expect(res.documentos).toEqual([]);
    expect(res.mensaje).toContain('no corresponde a una empresa autorizada');
  });

  it('falls back to the fixed not-authorized phrasing when the marker is not in a table cell', async () => {
    // Marker present in the body but OUTSIDE any <td> (e.g. a bare <p>) → still a clean
    // negative, with the fixed fallback sentence (the cell-extraction path finds nothing).
    const res = await fetchDteAutorizados(
      driverWith(
        () =>
          '<html><body><p>El rut que ha ingresado, no corresponde a una empresa autorizada a emitir Facturas Electronicas.</p></body></html>',
      ),
      RUT,
    );
    expect(res.autorizado).toBe(false);
    expect(res.mensaje).toBe(
      'El rut que ha ingresado, no corresponde a una empresa autorizada a emitir Facturas Electronicas.',
    );
  });

  it('an unrecognizable body (no header, no docs, no marker) is a scraper-roto DteError', async () => {
    await expect(
      fetchDteAutorizados(
        driverWith(() => '<html><body><p>algo inesperado</p></body></html>'),
        RUT,
      ),
    ).rejects.toBeInstanceOf(DteError);
  });

  it('a network/CGI failure becomes a DteError (never a raw fetch error)', async () => {
    const driver = new FakePortalDriver({ failPublic: new Error('ECONNRESET') });
    await expect(fetchDteAutorizados(driver, RUT)).rejects.toBeInstanceOf(DteError);
  });

  it('a non-200 response is a DteError (infrastructure failure, not a user condition)', async () => {
    const driver = new FakePortalDriver({ requestPublic: () => ({ status: 503, body: '' }) });
    await expect(fetchDteAutorizados(driver, RUT)).rejects.toThrow('HTTP 503');
  });
});
