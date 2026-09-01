import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { F29Error } from '../errors/index.js';
import { Rut } from '../rut/index.js';
import { f29PdfUrl, fetchF29Pdf } from './f29-pdf.js';

// Synthetic throughout (no real folio / RUT / codInt — CONVENTIONS PII hygiene).
const RUT = Rut.parse('77777777-7');
const FOLIO = 1234567890;
const CODIGO = 987654321;

const pdfBytes = (): Uint8Array => new TextEncoder().encode('%PDF-1.4\nsynthetic\n%%EOF');

// SII's real refusal page shape: it echoes its <title> into the body (observed 2026-08-31).
const ERROR_HTML =
  '<html><head><title>Ha ocurrido un error al imprimir PDF</title></head><body>' +
  '<b>Ha ocurrido un Error al generar documento PDF</b><br>' +
  '<b>No est\xE1 autorizado para realizar esta acci\xF3n.</b></body></html>';
const latin1 = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

describe('f29PdfUrl', () => {
  it('builds the compacto URL WITHOUT dv and the solemne URL WITH it', () => {
    const compacto = f29PdfUrl({ tipo: 'compacto', rut: RUT, folio: FOLIO, codigo: CODIGO });
    const solemne = f29PdfUrl({ tipo: 'solemne', rut: RUT, folio: FOLIO, codigo: CODIGO });

    expect(compacto).toContain('/rfiInternet/formCompacto?');
    expect(compacto).toContain(`folio=${FOLIO}`);
    expect(compacto).toContain('rut=77777777'); // body only — SII takes no DV here
    expect(compacto).toContain('form=029');
    expect(compacto).toContain(`codInt=${CODIGO}`);
    expect(compacto).not.toContain('dv=');

    expect(solemne).toContain('/rfiInternet/formSolemne?');
    expect(solemne).toContain('dv=7'); // only the solemne takes the DV (observed)
    expect(solemne).toContain(`codInt=${CODIGO}`);
  });
});

describe('fetchF29Pdf (fake session, no SII)', () => {
  it('returns the bytes when content-type is PDF and the magic matches', async () => {
    const session = new FakePortalSession({
      requestBinary: () => ({ status: 200, contentType: 'application/pdf', bytes: pdfBytes() }),
    });
    const res = await fetchF29Pdf(session, {
      tipo: 'compacto',
      rut: RUT,
      folio: FOLIO,
      codigo: CODIGO,
    });

    expect(res.tipo).toBe('compacto');
    expect(res.contentType).toBe('application/pdf');
    expect(new TextDecoder().decode(res.bytes.subarray(0, 5))).toBe('%PDF-');
    expect(session.lastBinaryRequest?.url).toContain('formCompacto');
    expect(session.lastBinaryRequest?.options?.method).toBe('GET');
  });

  it("surfaces SII's refusal VERBATIM when the servlet answers HTML — even with status 200", async () => {
    // SII returns 200 for its own error page, so status must NOT be the success signal.
    const session = new FakePortalSession({
      requestBinary: () => ({
        status: 200,
        contentType: 'text/html;charset=ISO-8859-1',
        bytes: latin1(ERROR_HTML),
      }),
    });
    await expect(
      fetchF29Pdf(session, { tipo: 'compacto', rut: RUT, folio: FOLIO, codigo: CODIGO }),
    ).rejects.toThrow(F29Error);

    const err = await fetchF29Pdf(session, {
      tipo: 'compacto',
      rut: RUT,
      folio: FOLIO,
      codigo: CODIGO,
    }).catch((e: unknown) => e as Error);

    // Verbatim, accents intact (ISO-8859-1 decoded), title echo collapsed.
    expect(err.message).toContain('Ha ocurrido un Error al generar documento PDF');
    expect(err.message).toContain('No está autorizado para realizar esta acción.');
    expect(err.message.match(/No está autorizado/g)).toHaveLength(1);
  });

  it('rejects a 200 whose content-type claims PDF but whose body is not (scraper roto)', async () => {
    const session = new FakePortalSession({
      requestBinary: () => ({
        status: 200,
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('not a pdf at all'),
      }),
    });
    await expect(
      fetchF29Pdf(session, { tipo: 'solemne', rut: RUT, folio: FOLIO, codigo: CODIGO }),
    ).rejects.toThrow(/Scraper roto/i);
  });
});
