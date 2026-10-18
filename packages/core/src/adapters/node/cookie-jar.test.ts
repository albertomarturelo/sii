import { describe, it, expect } from 'vitest';
import { CookieJar } from './cookie-jar.js';

describe('CookieJar', () => {
  it('sends a shared (.sii.cl) cookie to a sub-host, but a host-only cookie only to its host', () => {
    const jar = new CookieJar();
    jar.applySetCookies('https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi', [
      'TOKEN=abc; Domain=.sii.cl; Path=/; HttpOnly',
      'TS0161=waf; Path=/', // host-only (no Domain) → zeusr only
    ]);
    // Shared cookie reaches www4; host-only WAF cookie does not.
    expect(jar.header('https://www4.sii.cl/consdcvinternetui/')).toBe('TOKEN=abc');
    // On the same host both are sent.
    const onZeusr = jar.header('https://zeusr.sii.cl/cgi_AUT2000/x');
    expect(onZeusr).toContain('TOKEN=abc');
    expect(onZeusr).toContain('TS0161=waf');
  });

  it('deletes a cookie on an empty value or a non-positive Max-Age (logout clears the jar)', () => {
    const jar = new CookieJar();
    jar.applySetCookies('https://zeusr.sii.cl/', ['TOKEN=abc; Domain=.sii.cl; Path=/']);
    expect(jar.header('https://misiir.sii.cl/')).toBe('TOKEN=abc');
    jar.applySetCookies('https://zeusr.sii.cl/', ['TOKEN=; Domain=.sii.cl; Path=/; Max-Age=0']);
    expect(jar.header('https://misiir.sii.cl/')).toBeNull();
  });

  it('does not send an expired cookie', () => {
    const jar = new CookieJar();
    jar.applySetCookies('https://zeusr.sii.cl/', [
      'OLD=1; Domain=.sii.cl; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ]);
    expect(jar.header('https://www4.sii.cl/')).toBeNull();
  });

  it('matches by path prefix', () => {
    const jar = new CookieJar();
    jar.applySetCookies('https://www1.sii.cl/cgi-bin/Portal001/x', [
      'SCOPED=1; Domain=www1.sii.cl; Path=/cgi-bin/Portal001',
    ]);
    expect(jar.header('https://www1.sii.cl/cgi-bin/Portal001/mipe.cgi')).toBe('SCOPED=1');
    expect(jar.header('https://www1.sii.cl/otra/ruta')).toBeNull();
  });

  it('reads a single cookie value visible to a URL', () => {
    const jar = new CookieJar();
    jar.applySetCookies('https://www4.sii.cl/', ['TOKEN=conv123; Domain=.sii.cl; Path=/']);
    expect(jar.value('https://www4.sii.cl/consdcvinternetui/', 'TOKEN')).toBe('conv123');
    expect(jar.value('https://www4.sii.cl/', 'MISSING')).toBeNull();
  });

  it('round-trips through storageState preserving the shared/host-only split', () => {
    const jar = new CookieJar();
    jar.applySetCookies('https://zeusr.sii.cl/', [
      'TOKEN=abc; Domain=.sii.cl; Path=/',
      'TS=waf; Path=/',
    ]);
    const state = jar.toStorageState();
    // Playwright convention: shared cookie exported with a leading-dot domain, host-only bare.
    const token = state.cookies.find((c) => c.name === 'TOKEN');
    const ts = state.cookies.find((c) => c.name === 'TS');
    expect(token?.domain).toBe('.sii.cl');
    expect(ts?.domain).toBe('zeusr.sii.cl');

    const restored = CookieJar.fromStorageState(state);
    expect(restored.header('https://www4.sii.cl/')).toBe('TOKEN=abc'); // shared reaches www4
    expect(restored.header('https://zeusr.sii.cl/')).toContain('TS=waf'); // host-only on zeusr
    expect(restored.header('https://www4.sii.cl/')).not.toContain('TS=waf');
  });

  it('restores empty from a garbage/missing state rather than throwing', () => {
    expect(CookieJar.fromStorageState(null).header('https://www4.sii.cl/')).toBeNull();
    expect(CookieJar.fromStorageState({}).header('https://www4.sii.cl/')).toBeNull();
    expect(CookieJar.fromStorageState({ cookies: 'nope' }).header('https://x.sii.cl/')).toBeNull();
  });
});
