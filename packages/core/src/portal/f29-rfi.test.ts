import { afterEach, describe, expect, it } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { HOSTS } from '../config/index.js';
import { F29Error } from '../errors/index.js';
import { clearGwtPermutations } from './gwt.js';
import { RFI_FORMULARIO, callFormularioFacade } from './f29-rfi.js';

// SYNTHETIC permutation + responses: one policy, one signature, no captured data.
const PERM = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const POLICY = '33333333333333333333333333333333';
const PERM_JS =
  `function PHc(){Yc.call(this,nge(),'formularioFacade','${POLICY}',VDc)}` +
  `a1='java.lang.String/2004016611';a2='java.lang.Integer/3438268394';`;

function session(answer: string): FakePortalSession {
  return new FakePortalSession({
    requestText: (url, opts) => {
      if (opts?.method === 'GET') return url.endsWith('rfi.nocache.js') ? `x='${PERM}'` : PERM_JS;
      return answer;
    },
  });
}

describe('callFormularioFacade', () => {
  afterEach(() => clearGwtPermutations());

  it('posts to formularioFacade with the live policy and decodes the result', async () => {
    const s = session('//OK[1,["listo"],0,7]');
    const v = await callFormularioFacade(
      s,
      'consultarHijoToken',
      [{ type: 'java.lang.String', value: 'PARAM_X' }],
      { returns: 'java.lang.String' },
    );
    expect(v).toBe('listo');
    expect(s.lastTextRequest?.url).toBe(`${HOSTS.portalApi}/rfiInternet/formularioFacade`);
    expect(s.lastTextRequest?.options?.body).toBe(
      `7|0|6|${RFI_FORMULARIO.moduleBase}|${POLICY}|` +
        'cl.sii.sdi.dim.rfi.web.client.service.FormularioFacade|consultarHijoToken|' +
        'java.lang.String/2004016611|PARAM_X|1|2|3|4|1|5|6|',
    );
  });

  it("raises SII's //EX verbatim as an F29Error", async () => {
    const s = session(
      '//EX[2,1,["cl.sii.sdi.dim.rfi.web.shared.exception.RfiException/1","Sin propuesta"],0,7]',
    );
    await expect(callFormularioFacade(s, 'findAllFormulario', [])).rejects.toThrow(F29Error);
    await expect(callFormularioFacade(s, 'findAllFormulario', [])).rejects.toThrow(
      'SII rechazó la operación: Sin propuesta',
    );
  });
});
