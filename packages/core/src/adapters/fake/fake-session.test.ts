import { describe, it, expect } from 'vitest';
import { FakePortalSession } from './index.js';

// The authenticated form-POST seam (ADR-017) surfaces through the fake so the emit
// facade can be unit-tested without a browser. These assert the fake's contract.
describe('FakePortalSession.requestForm (form-POST seam fake)', () => {
  it('records the URL + form fields sent (lets a test assert the emit payload)', async () => {
    const s = new FakePortalSession({
      requestForm: () => '<html>ok</html>',
    });
    const res = await s.requestForm(
      'https://loa.sii.cl/cgi_IMT/TMBECN_ConfirmaTimbrajeContrib.cgi',
      {
        form: { rut_arrastre: '20000042', OptTipoRetencion: 'RETRECEPTOR' },
      },
    );
    expect(res).toEqual({ status: 200, body: '<html>ok</html>' });
    expect(s.lastFormRequest?.url).toContain('ConfirmaTimbrajeContrib');
    expect(s.lastFormRequest?.options?.form).toMatchObject({ OptTipoRetencion: 'RETRECEPTOR' });
  });

  it('a string script result becomes a 200 PublicResponse; a full response passes through', async () => {
    const str = new FakePortalSession({ requestForm: () => 'plain' });
    expect(await str.requestForm('https://x')).toEqual({ status: 200, body: 'plain' });
    const full = new FakePortalSession({ requestForm: () => ({ status: 500, body: 'err' }) });
    expect(await full.requestForm('https://x')).toEqual({ status: 500, body: 'err' });
  });

  it('no script → an empty 200 body (never throws)', async () => {
    const s = new FakePortalSession();
    expect(await s.requestForm('https://x', { form: {} })).toEqual({ status: 200, body: '' });
  });
});
