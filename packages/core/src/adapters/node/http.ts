// The DEFAULT PortalDriver since ADR-027: a browser-free adapter over Node `fetch` plus
// the in-house CookieJar. A live spike (2026-10-17, one attempt, no browser) confirmed the
// classic SII login works as a plain POST and the resulting jar reaches Mi SII and the www4
// SDI facades — so every surface that does NOT run SII's own page JS needs no Chromium.
//
// What it CANNOT do: `evaluate` (run page JS) and `interactiveLogin` (a human at SII's page).
// Both throw BrowserRequiredError; a surface that needs them asks withSession for the
// `browser` engine (the lazy Playwright driver), which is the only thing that still needs
// Chromium (BTE inline maps, MIPYME `validaFacEx`). ADR-027.
//
// Auth detection stays URL-based (sii-py ADR-009) with ONE documented exception: the login
// POST itself answers 200 on `zeusr` for BOTH success and failure (observed 2026-10-17), so
// credentialLogin decides from the body (SII's error código) + the session cookie, not the host.
// And where SII bounces a dead jar to the login with JS instead of an HTTP redirect (Mi SII,
// GH-139), the driver reports the login URL as the landing, as a browser would.
import { LOGIN_HOST, LOGIN_POST_URL, QUEUE_IT_HOST, loginUrl } from '../../config/index.js';
import { LoginFailedError, LoginQueuedError, BrowserRequiredError } from '../../errors/index.js';
import { parseSiiLoginErrorDetail } from '../../auth/login-error.js';
import { Rut } from '../../rut/index.js';
import {
  LOGIN_STUB_MAX_BYTES,
  charsetOfBody,
  formLoginWallError,
  loginStubTarget,
  nonJsonResponseError,
} from './response.js';
import { CookieJar } from './cookie-jar.js';
import { overNetwork } from './network.js';
import type {
  BinaryRequest,
  BinaryResponse,
  CredentialLoginOptions,
  FormRequest,
  InteractiveLoginOptions,
  JsonRequest,
  PortalDriver,
  PortalSession,
  PublicRequest,
  PublicResponse,
  TextRequest,
} from '../../seams/index.js';

/** The `fetch` implementation, injectable so tests drive a fake without a network (ADR-003). */
export type FetchLike = typeof globalThis.fetch;

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 10;
// A browser-like User-Agent is REQUIRED on the authenticated requests: Playwright's
// APIRequestContext sent the Chromium UA automatically, and SII's www4 WAF bounces a UA-less
// client to the login wall even with a valid session cookie — misiir is laxer, which masked it
// (observed 2026-10-18, GH live validation of ADR-027; the 2026-10-17 spike worked only because
// it set a Chrome UA). A caller's explicit `User-Agent` still wins.
const BROWSER_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'accept-language': 'es-CL,es;q=0.9',
};
const BROWSER_ONLY =
  'Esta operación necesita el motor de navegador (JS de la página de SII). El PortalDriver ' +
  'HTTP no puede ejecutarlo (ADR-027). Instala y usa el motor Playwright: `npm i playwright` + ' +
  '`npx playwright install chromium`.';

interface RawResponse {
  finalUrl: string;
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
}

/** A fetch that carries a CookieJar across MANUAL redirects: Node `fetch` would neither apply
 *  `Set-Cookie` per hop nor re-attach our jar, and SII sets the session cookies mid-redirect
 *  (login) and detects a dead jar by bouncing to `LOGIN_HOST`. Each hop applies Set-Cookie into
 *  the jar and re-sends the jar's Cookie header; the landed URL is what the caller checks. */
async function fetchWithJar(
  fetchImpl: FetchLike,
  jar: CookieJar,
  startUrl: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<RawResponse> {
  let url = startUrl;
  let method = init.method;
  let body: string | undefined = init.body;
  let headers = { ...init.headers };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const cookie = jar.header(url);
    // Build the headers CASE-INSENSITIVELY via Headers.set: a facade passes `Content-Type`
    // while BROWSER_HEADERS/`jsonHeaders` use `content-type`, and a plain object would keep
    // BOTH keys — undici then appends them into `application/json, application/json`, which
    // www4 answers with HTTP 500. `set` lowercases and overwrites, so each header is sent once.
    // Browser headers first so a caller's explicit value wins. (ADR-027, GH live validation.)
    const sent = new Headers();
    for (const [k, v] of Object.entries({ ...BROWSER_HEADERS, ...headers })) sent.set(k, v);
    if (cookie) sent.set('cookie', cookie);
    const hopUrl = url;
    const res = await overNetwork(hopUrl, () =>
      fetchImpl(hopUrl, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(body !== undefined ? { body } : {}),
        headers: sent,
      }),
    );
    jar.applySetCookies(url, res.headers.getSetCookie?.() ?? []);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).href;
      // A 303, or a 301/302 after a POST, continues as GET without the body (fetch semantics).
      if (res.status !== 307 && res.status !== 308) {
        method = 'GET';
        body = undefined;
        headers = stripBodyHeaders(headers);
      }
      continue;
    }
    const bytes = new Uint8Array(await overNetwork(hopUrl, () => res.arrayBuffer()));
    const contentType = res.headers.get('content-type');
    return {
      finalUrl: jsLoginWallUrl(res.status, contentType, bytes) ?? (res.url || url),
      status: res.status,
      contentType,
      bytes,
    };
  }
  throw new Error(`Demasiadas redirecciones (> ${MAX_REDIRECTS}) desde ${startUrl}`);
}

/** Where a browser would land when SII bounces a dead jar to the login with JS instead of an
 *  HTTP redirect (Mi SII, GH-139). Reporting THAT as the landed URL keeps auth detection
 *  URL-based for every primitive (goto, requestText/Form/Binary, requestJson) without each one
 *  parsing bodies. Only a small 2xx HTML page is scanned (`loginStubTarget` is the narrow test). */
function jsLoginWallUrl(
  status: number,
  contentType: string | null,
  bytes: Uint8Array,
): string | null {
  if (status < 200 || status >= 300) return null;
  if (!(contentType ?? '').toLowerCase().includes('text/html')) return null;
  if (bytes.length > LOGIN_STUB_MAX_BYTES) return null;
  return loginStubTarget(new TextDecoder(charsetOfBody(contentType, bytes)).decode(bytes));
}

function stripBodyHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-type') continue;
    out[k] = v;
  }
  return out;
}

const decode = (r: RawResponse): string =>
  new TextDecoder(charsetOfBody(r.contentType, r.bytes)).decode(r.bytes);
const landedOn = (url: string, host: string): boolean => new URL(url).hostname === host;

class HttpPortalSession implements PortalSession {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly jar: CookieJar,
  ) {}

  async goto(url: string): Promise<string> {
    const r = await fetchWithJar(this.fetchImpl, this.jar, url, { method: 'GET' });
    return r.finalUrl;
  }

  evaluate<T>(_expression: string): Promise<T> {
    // The HTTP driver cannot run page JS (ADR-027). A surface that needs it (BTE inline maps,
    // MIPYME validaFacEx) must acquire the browser engine via withSession.
    return Promise.reject(new BrowserRequiredError(BROWSER_ONLY));
  }

  async requestJson(url: string, options: JsonRequest = {}): Promise<unknown> {
    const headers = options.body !== undefined ? jsonHeaders(options.headers) : options.headers;
    const r = await fetchWithJar(this.fetchImpl, this.jar, url, {
      method: options.method ?? 'POST',
      ...(headers ? { headers } : {}),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = decode(r);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Same classification as the Playwright adapter: a login-wall bounce / HTML body ⇒
      // SessionExpiredError; anything else ⇒ UnexpectedResponseError naming endpoint + body.
      throw nonJsonResponseError(r.finalUrl, r.contentType ?? '', r.status, text);
    }
  }

  async requestForm(url: string, options: FormRequest = {}): Promise<PublicResponse> {
    const headers = { ...options.headers };
    let body: string | undefined;
    if (options.form) {
      body = new URLSearchParams(options.form).toString();
      headers['content-type'] ??= 'application/x-www-form-urlencoded';
    }
    const r = await fetchWithJar(this.fetchImpl, this.jar, url, {
      method: options.method ?? 'POST',
      headers,
      ...(body !== undefined ? { body } : {}),
    });
    const wall = formLoginWallError(r.finalUrl);
    if (wall) throw wall;
    return { status: r.status, body: decode(r) };
  }

  async requestText(url: string, options: TextRequest = {}): Promise<PublicResponse> {
    const r = await fetchWithJar(this.fetchImpl, this.jar, url, {
      method: options.method ?? 'POST',
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
    });
    const wall = formLoginWallError(r.finalUrl);
    if (wall) throw wall;
    return { status: r.status, body: decode(r) };
  }

  async requestBinary(url: string, options: BinaryRequest = {}): Promise<BinaryResponse> {
    const r = await fetchWithJar(this.fetchImpl, this.jar, url, {
      method: options.method ?? 'GET',
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
    });
    const wall = formLoginWallError(r.finalUrl);
    if (wall) throw wall;
    return { status: r.status, contentType: r.contentType, bytes: r.bytes };
  }

  cookie(url: string, name: string): Promise<string | null> {
    return Promise.resolve(this.jar.value(url, name));
  }

  storageState(): Promise<unknown> {
    return Promise.resolve(this.jar.toStorageState());
  }

  close(): Promise<void> {
    return Promise.resolve(); // no browser to tear down
  }
}

function jsonHeaders(headers?: Record<string, string>): Record<string, string> {
  const h = { ...headers };
  h['content-type'] ??= 'application/json';
  return h;
}

export class HttpPortalDriver implements PortalDriver {
  constructor(private readonly fetchImpl: FetchLike = globalThis.fetch) {}

  interactiveLogin(_options: InteractiveLoginOptions): Promise<PortalSession> {
    // A headed browser login is the MCP's job (ADR-027); the HTTP CLI uses credentialLogin.
    return Promise.reject(new BrowserRequiredError(BROWSER_ONLY));
  }

  async credentialLogin(options: CredentialLoginOptions): Promise<PortalSession> {
    const jar = new CookieJar();
    // 1. Warm-up GET of the login page — collects the F5 WAF's `TS*` cookies BEFORE the POST
    //    (observed 2026-10-17: the GET sets them and the POST is accepted with them present).
    await fetchWithJar(this.fetchImpl, jar, loginUrl(options.destination), { method: 'GET' });

    // 2. The exact five form fields the page JS computes (auth-login.md, re-confirmed
    //    2026-10-17): the RUT split into body (leading zeros dropped) + DV, the dotted RUT in
    //    `rutcntr`, the destination in `referencia`, `411` empty, and the Clave.
    const rut = Rut.parse(options.rut);
    const form = new URLSearchParams({
      rut: String(rut.body),
      dv: rut.dv,
      referencia: options.destination,
      '411': '',
      rutcntr: rut.formatted,
      clave: options.clave,
    });
    const r = await fetchWithJar(this.fetchImpl, jar, LOGIN_POST_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: `https://${LOGIN_HOST}`,
        referer: loginUrl(options.destination),
      },
      body: form.toString(),
    });

    // 3. Queue-it waiting room ⇒ stop (an HTTP client cannot pass it).
    if (landedOn(r.finalUrl, QUEUE_IT_HOST)) {
      throw new LoginQueuedError(
        'El SII está derivando el ingreso a su sala de espera (salaespera.sii.cl). ' +
          'Intenta más tarde; no se reintenta automáticamente.',
      );
    }

    // 4. Success vs rejection. SII answers 200 on `zeusr` either way (observed 2026-10-17), so
    //    the body is the signal: a rejected Clave renders the error código page. Parse it and
    //    surface SII's verbatim message + the typed reason/código (#124). ONE attempt, never
    //    retried (ADR-004). A changed shape with no session cookie falls through to the generic
    //    "not completed" below — the caller's Mi SII identity read is the final proof.
    const detail = parseSiiLoginErrorDetail(decode(r));
    if (detail.message !== null) {
      throw new LoginFailedError(detail.message, { reason: detail.reason, codigo: detail.codigo });
    }
    return new HttpPortalSession(this.fetchImpl, jar);
  }

  restore(storageState: unknown): Promise<PortalSession> {
    return Promise.resolve(
      new HttpPortalSession(this.fetchImpl, CookieJar.fromStorageState(storageState)),
    );
  }

  async requestPublic(url: string, options: PublicRequest = {}): Promise<PublicResponse> {
    // UNAUTHENTICATED public consulta (ADR-014): a cold request, no jar, no session. Headers are
    // built through `Headers` (case-insensitive) so a caller-supplied `content-type` can't collide
    // with the default and get appended into a duplicate — the class of bug that 500'd www4 on the
    // authenticated path (GH live validation 2026-10-18); `Headers.has` is case-insensitive.
    const headers = new Headers();
    for (const [k, v] of Object.entries(options.headers ?? {})) headers.set(k, v);
    let body: string | undefined;
    if (options.form) {
      body = new URLSearchParams(options.form).toString();
      if (!headers.has('content-type'))
        headers.set('content-type', 'application/x-www-form-urlencoded');
    }
    const response = await overNetwork(url, () =>
      this.fetchImpl(url, {
        method: options.method ?? 'POST',
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(body !== undefined ? { body } : {}),
      }),
    );
    const buffer = await overNetwork(url, () => response.arrayBuffer());
    const text = new TextDecoder(
      charsetOfBody(response.headers.get('content-type'), new Uint8Array(buffer)),
    ).decode(buffer);
    return { status: response.status, body: text };
  }
}
