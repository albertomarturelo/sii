import { describe, it, expect } from 'vitest';
import { HttpPortalDriver } from './http.js';
import type { FetchLike } from './http.js';
import {
  BrowserRequiredError,
  LoginFailedError,
  LoginQueuedError,
  SessionExpiredError,
} from '../../errors/index.js';

const MI_SII = 'https://misiir.sii.cl/cgi_misii/siihome.cgi';

interface Scripted {
  status?: number;
  headers?: Record<string, string>;
  setCookies?: string[];
  body?: string | Uint8Array;
}
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fake `fetch`: `route(url, call)` returns a scripted response (or a Response). Records every
 *  call so a test can assert the URL / cookies / POST body sent — no network (ADR-003). */
function fakeFetch(route: (url: string, nth: number) => Scripted): {
  impl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = normalizeHeaders(init?.headers);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    const s = route(url, calls.length);
    const respHeaders = new Headers(s.headers ?? {});
    for (const sc of s.setCookies ?? []) respHeaders.append('set-cookie', sc);
    const status = s.status ?? 200;
    const body = status === 204 || status === 304 ? null : (s.body ?? '');
    return new Response(body as BodyInit | null, { status, headers: respHeaders });
  }) as FetchLike;
  return { impl, calls };
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => (out[k] = v));
  return out;
}

const LOGIN = { rut: '11111111-1', clave: 'secret123', destination: MI_SII, timeoutMs: 1000 };

describe('HttpPortalDriver — credentialLogin', () => {
  it('warms up, POSTs the five form fields, and returns a session carrying the cookies', async () => {
    const { impl, calls } = fakeFetch((url) => {
      if (url.includes('IngresoRutClave.html')) {
        return { setCookies: ['TS0161=waf; Path=/'] }; // F5 warm-up
      }
      if (url.includes('CAutInicio.cgi')) {
        // Success: session cookies set, body JS-navigates (no error código line).
        return {
          setCookies: [
            'TOKEN=tok; Domain=.sii.cl; Path=/',
            'CSESSIONID=sess; Domain=.sii.cl; Path=/',
          ],
          body: `<html><script>location.href='${MI_SII}'</script></html>`,
        };
      }
      return {};
    });

    const session = await new HttpPortalDriver(impl).credentialLogin(LOGIN);

    const post = calls.find((c) => c.url.includes('CAutInicio.cgi'));
    expect(post?.method).toBe('POST');
    const form = new URLSearchParams(post?.body ?? '');
    expect(form.get('rut')).toBe('11111111'); // body only, no DV
    expect(form.get('dv')).toBe('1');
    expect(form.get('rutcntr')).toBe('11.111.111-1'); // dotted, as the page JS computes
    expect(form.get('referencia')).toBe(MI_SII);
    expect(form.get('411')).toBe('');
    expect(form.get('clave')).toBe('secret123');
    // The warm-up WAF cookie rides on the POST (jar carried it).
    expect(post?.headers['cookie']).toContain('TS0161=waf');

    // The persisted jar carries the session cookies (and the warm-up WAF cookie rides along too).
    const state = (await session.storageState()) as { cookies: { name: string }[] };
    const names = state.cookies.map((c) => c.name);
    expect(names).toContain('TOKEN');
    expect(names).toContain('CSESSIONID');
  });

  it("throws a typed LoginFailedError (wrong-clave) on SII's error página", async () => {
    const { impl } = fakeFetch((url) => {
      if (url.includes('IngresoRutClave.html')) return {};
      // SII renders the error as page body text, staying on zeusr (observed 2026-06-28).
      return {
        body:
          'La Clave Tributaria ingresada no es correcta, verifique que su teclado…\n' +
          'El código de este mensaje es 01.01.203.500.720.20',
      };
    });
    await expect(new HttpPortalDriver(impl).credentialLogin(LOGIN)).rejects.toMatchObject({
      name: 'LoginFailedError',
      reason: 'wrong-clave',
      codigo: '01.01.203.500.720.20',
    });
    await expect(new HttpPortalDriver(impl).credentialLogin(LOGIN)).rejects.toBeInstanceOf(
      LoginFailedError,
    );
  });

  it('throws LoginQueuedError when the login is redirected to the Queue-it waiting room', async () => {
    const { impl } = fakeFetch((url) => {
      if (url.includes('IngresoRutClave.html')) return {};
      if (url.includes('CAutInicio.cgi')) {
        return { status: 302, headers: { location: 'https://salaespera.sii.cl/?c=sii' } };
      }
      return { body: 'waiting room' };
    });
    await expect(new HttpPortalDriver(impl).credentialLogin(LOGIN)).rejects.toBeInstanceOf(
      LoginQueuedError,
    );
  });
});

describe('HttpPortalDriver — session primitives', () => {
  const okJson = (): ReturnType<typeof fakeFetch> =>
    fakeFetch(() => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ respEstado: { codRespuesta: 0 }, data: [] }),
    }));

  it('restore builds a session whose jar sends the stored cookies', async () => {
    const { impl, calls } = okJson();
    const session = await new HttpPortalDriver(impl).restore({
      cookies: [
        {
          name: 'TOKEN',
          value: 'tok',
          domain: '.sii.cl',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
    });
    await session.requestJson('https://www4.sii.cl/consdcvinternetui/x');
    expect(calls[0]?.headers['cookie']).toBe('TOKEN=tok');
  });

  it('sends a browser User-Agent on authenticated requests (www4 WAF rejects a bare client)', async () => {
    const { impl, calls } = okJson();
    const session = await new HttpPortalDriver(impl).restore({ cookies: [] });
    await session.requestJson('https://www4.sii.cl/consdcvinternetui/x');
    // Regression guard (ADR-027 live validation 2026-10-18): a missing UA bounced www4 to the
    // login wall even with a valid session (misiir was laxer, which hid it).
    expect(calls[0]?.headers['user-agent']).toMatch(/Mozilla\/5\.0.*Chrome/);
  });

  it('requestJson parses JSON, and maps an HTML login-wall bounce to SessionExpiredError', async () => {
    const good = okJson();
    const session = await new HttpPortalDriver(good.impl).restore({ cookies: [] });
    expect(await session.requestJson('https://www4.sii.cl/x')).toEqual({
      respEstado: { codRespuesta: 0 },
      data: [],
    });

    const wall = fakeFetch(() => ({
      headers: { 'content-type': 'text/html' },
      body: '<html>login</html>',
    }));
    const dead = await new HttpPortalDriver(wall.impl).restore({ cookies: [] });
    await expect(dead.requestJson('https://www4.sii.cl/x')).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });

  it('requestBinary returns undecoded bytes + content-type', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const { impl } = fakeFetch(() => ({
      headers: { 'content-type': 'application/pdf' },
      body: pdf,
    }));
    const session = await new HttpPortalDriver(impl).restore({ cookies: [] });
    const r = await session.requestBinary('https://www4.sii.cl/f29.pdf');
    expect(r.contentType).toBe('application/pdf');
    expect([...r.bytes]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('carries cookies across a redirect in goto', async () => {
    const { impl, calls } = fakeFetch((url, nth) => {
      if (nth === 1) {
        return {
          status: 302,
          setCookies: ['HOP=1; Domain=.sii.cl; Path=/'],
          headers: { location: MI_SII },
        };
      }
      return { body: 'ok' };
    });
    const session = await new HttpPortalDriver(impl).restore({ cookies: [] });
    const landed = await session.goto('https://misiir.sii.cl/start');
    expect(landed).toBe(MI_SII);
    // Second hop carried the cookie set on the first.
    expect(calls[1]?.headers['cookie']).toContain('HOP=1');
  });

  it('evaluate and interactiveLogin require the browser engine', async () => {
    const driver = new HttpPortalDriver(okJson().impl);
    const session = await driver.restore({ cookies: [] });
    await expect(session.evaluate('1+1')).rejects.toBeInstanceOf(BrowserRequiredError);
    await expect(
      driver.interactiveLogin({ destination: MI_SII, timeoutMs: 1 }),
    ).rejects.toBeInstanceOf(BrowserRequiredError);
  });
});
