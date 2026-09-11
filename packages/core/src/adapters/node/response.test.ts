import { describe, it, expect } from 'vitest';
import { charsetOf, formLoginWallError, nonJsonResponseError } from './response.js';
import { SessionExpiredError, UnexpectedResponseError } from '../../errors/index.js';

describe('nonJsonResponseError (SDI non-JSON classification)', () => {
  it('a response bounced to the login host → SessionExpiredError (actionable)', () => {
    const e = nonJsonResponseError('https://zeusr.sii.cl/AUT2000/login.html', 'text/html', 200);
    expect(e).toBeInstanceOf(SessionExpiredError);
    expect(e.message).toContain('sii auth login');
  });

  it('an HTML body on the same SDI host (same-host login wall) → SessionExpiredError', () => {
    const e = nonJsonResponseError(
      'https://www4.sii.cl/consdcvinternetui/x',
      'text/html; charset=UTF-8',
      200,
    );
    expect(e).toBeInstanceOf(SessionExpiredError);
  });

  it('a non-HTML unexpected response on an SDI host → UnexpectedResponseError with status + content-type', () => {
    const e = nonJsonResponseError('https://www4.sii.cl/consdcvinternetui/x', 'text/plain', 502);
    expect(e).toBeInstanceOf(UnexpectedResponseError);
    expect(e).not.toBeInstanceOf(SessionExpiredError);
    expect(e.message).toContain('502');
    expect(e.message).toContain('text/plain');
  });

  it('an empty content-type still produces a readable message', () => {
    const e = nonJsonResponseError('https://www4.sii.cl/x', '', 500);
    expect(e).toBeInstanceOf(UnexpectedResponseError);
    expect(e.message).toContain('sin content-type');
    expect(e.message).toContain('cuerpo vacío');
  });

  // Observed live 2026-09-11 (GH-111): a live session on cte-api obtenerValorParametro gets
  // HTTP 200 text/plain with a bare URL. Not a wall; the error must show the body.
  it('a 200 text/plain bare URL on a non-login host → UnexpectedResponseError naming endpoint + body', () => {
    const e = nonJsonResponseError(
      'https://www2.sii.cl/app/cte-api-carpetatributaria/11111111-1/recurso/v2/carpeta-tributaria/obtenerValorParametro',
      'text/plain;charset=utf-8',
      200,
      'https://www4.sii.cl/modificacioncntrui/#/modificacionmail',
    );
    expect(e).toBeInstanceOf(UnexpectedResponseError);
    expect(e).not.toBeInstanceOf(SessionExpiredError);
    expect(e.message).toContain('text/plain');
    expect(e.message).toContain('200');
    expect(e.message).toContain('/carpeta-tributaria/obtenerValorParametro');
    expect(e.message).toContain('https://www4.sii.cl/modificacioncntrui/#/modificacionmail');
  });

  it('a non-JSON body whose content-type CLAIMS json says so explicitly (the header lied)', () => {
    const e = nonJsonResponseError(
      'https://www4.sii.cl/consdcvinternetui/x',
      'application/json;charset=UTF-8',
      200,
      'texto plano',
    );
    expect(e).toBeInstanceOf(UnexpectedResponseError);
    expect(e.message).toContain('application/json');
    expect(e.message).toContain('no es JSON');
    expect(e.message).toContain('texto plano');
  });

  it('the body snippet is whitespace-collapsed and capped at ~80 chars', () => {
    const body = 'linea uno\n\tlinea   dos ' + 'x'.repeat(200);
    const e = nonJsonResponseError('https://www4.sii.cl/x', 'application/json', 200, body);
    expect(e.message).toContain('linea uno linea dos');
    expect(e.message).not.toContain('\n');
    expect(e.message).toContain('…');
    expect(e.message.length).toBeLessThan(260);
  });

  it('an HTML body served with a json content-type is still the login wall (HTML wins)', () => {
    const e = nonJsonResponseError(
      'https://www4.sii.cl/consdcvinternetui/x',
      'text/html; charset=UTF-8',
      200,
      '<html><body>Ingrese su RUT y Clave</body></html>',
    );
    expect(e).toBeInstanceOf(SessionExpiredError);
  });

  it('a bounce to LOGIN_HOST is the wall regardless of content-type or body', () => {
    const e = nonJsonResponseError(
      'https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi',
      'application/json',
      200,
      'texto',
    );
    expect(e).toBeInstanceOf(SessionExpiredError);
  });
});

describe('formLoginWallError (authenticated form-POST login-wall, ADR-017)', () => {
  it('a form POST bounced to the login host → SessionExpiredError (actionable)', () => {
    const e = formLoginWallError('https://zeusr.sii.cl/AUT2000/login.html');
    expect(e).toBeInstanceOf(SessionExpiredError);
    expect(e?.message).toContain('sii auth login');
  });

  it('an HTML response on the emit host (loa.sii.cl) is NOT a wall (HTML is expected) → null', () => {
    // Unlike requestJson, an HTML body from the TMBECN_* CGIs is the normal case.
    expect(
      formLoginWallError('https://loa.sii.cl/cgi_IMT/TMBECN_BoletaHonorariosElectronica.cgi'),
    ).toBeNull();
  });
});

describe('charsetOf (public-response charset for decoding)', () => {
  it('reads the declared charset (the palena DTE report is ISO-8859-1)', () => {
    expect(charsetOf('text/html; charset=ISO-8859-1')).toBe('ISO-8859-1');
  });

  it('is case/space/quote tolerant', () => {
    expect(charsetOf('text/html;  CHARSET="utf-8"')).toBe('utf-8');
  });

  it('defaults to utf-8 when no charset is declared', () => {
    expect(charsetOf('text/html')).toBe('utf-8');
    expect(charsetOf(null)).toBe('utf-8');
    expect(charsetOf(undefined)).toBe('utf-8');
  });

  it('falls back to utf-8 for a label TextDecoder cannot accept', () => {
    expect(charsetOf('text/html; charset=not-a-real-charset')).toBe('utf-8');
  });
});
