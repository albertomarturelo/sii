import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { RepresentacionError } from '../errors/index.js';
import { fetchEmpresasAutorizadas } from './representacion.js';

// All RUTs synthetic + Mod-11-valid (CONVENTIONS): self 20.000.042-0, empresa 96.500.000-3.
const ok = (rows: unknown[]): unknown => ({ respEstado: { codRespuesta: 0 }, data: rows });

const session = (envelope: unknown, cookies: Record<string, string> = {}): FakePortalSession =>
  new FakePortalSession({ requestJson: () => envelope, cookies });

describe('fetchEmpresasAutorizadas', () => {
  it('parses empresas from data[] and flags the self row', async () => {
    const s = session(
      ok([
        {
          usrEmpRut: '96500000',
          usrEmpDv: '3',
          razonSocONombreEmp: 'Empresa Sintética SpA',
          usrPrivilegios: 'ADMIN',
        },
        { usrEmpRut: '20000042', usrEmpDv: '0', razonSocONombreEmp: null },
      ]),
    );
    const res = await fetchEmpresasAutorizadas(s, '20000042-0');
    expect(res.rut).toBe('20000042-0');
    expect(res.empresas).toHaveLength(2);
    expect(res.empresas[0]).toMatchObject({
      rut: '96500000-3',
      razonSocial: 'Empresa Sintética SpA',
      privilegios: 'ADMIN',
      isSelf: false,
    });
    expect(res.empresas[1]).toMatchObject({ rut: '20000042-0', razonSocial: null, isSelf: true });
  });

  it('empty data[] is "no representations", not an error', async () => {
    const res = await fetchEmpresasAutorizadas(session(ok([])), '20000042-0');
    expect(res.empresas).toEqual([]);
  });

  it('tolerates the combined usrEmpRutDv alias', async () => {
    const res = await fetchEmpresasAutorizadas(session(ok([{ usrEmpRutDv: '96500000-3' }])), null);
    expect(res.empresas[0]?.rut).toBe('96500000-3');
  });

  it('raises RepresentacionError on an SII error envelope, message verbatim', async () => {
    const s = session({ respEstado: { codRespuesta: '-1', msgeRespuesta: 'Sesión expirada.' } });
    await expect(fetchEmpresasAutorizadas(s, '20000042-0')).rejects.toThrowError(
      'Sesión expirada.',
    );
    await expect(fetchEmpresasAutorizadas(s, '20000042-0')).rejects.toBeInstanceOf(
      RepresentacionError,
    );
  });

  it('raises RepresentacionError on a non-object response', async () => {
    await expect(fetchEmpresasAutorizadas(session(null), '20000042-0')).rejects.toBeInstanceOf(
      RepresentacionError,
    );
  });

  it('maps a non-JSON requestJson rejection to RepresentacionError', async () => {
    // requestJson rejects (e.g. an expired-session HTML redirect) → typed error.
    const s = new FakePortalSession({
      requestJson: () => {
        throw new Error('Unexpected token < in JSON');
      },
    });
    await expect(fetchEmpresasAutorizadas(s, '20000042-0')).rejects.toBeInstanceOf(
      RepresentacionError,
    );
  });

  it('POSTs to the SDI endpoint with the conversation TOKEN cookie', async () => {
    const s = session(ok([]), { TOKEN: 'conv-123' });
    await fetchEmpresasAutorizadas(s, '20000042-0');
    expect(s.lastRequest?.url).toContain('getDcvEmpresasAutorizadas');
    expect(s.lastRequest?.options?.method).toBe('POST');
    const body = s.lastRequest?.options?.body as { metaData?: { conversationId?: string } };
    expect(body?.metaData?.conversationId).toBe('conv-123');
  });
});
