import { describe, it, expect } from 'vitest';
import { nonJsonResponseError } from './response.js';
import { SessionExpiredError } from '../../errors/index.js';

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

  it('a non-HTML unexpected response on an SDI host → generic Error with status + content-type', () => {
    const e = nonJsonResponseError('https://www4.sii.cl/consdcvinternetui/x', 'text/plain', 502);
    expect(e).not.toBeInstanceOf(SessionExpiredError);
    expect(e.message).toContain('502');
    expect(e.message).toContain('text/plain');
  });

  it('an empty content-type still produces a readable generic message', () => {
    const e = nonJsonResponseError('https://www4.sii.cl/x', '', 500);
    expect(e).not.toBeInstanceOf(SessionExpiredError);
    expect(e.message).toContain('sin content-type');
  });
});
