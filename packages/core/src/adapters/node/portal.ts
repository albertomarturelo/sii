// The Node default PortalDriver (ADR-006 / ADR-008): a Playwright/Chromium
// adapter. This is the ONLY module that imports Playwright — the core reaches the
// browser exclusively through the PortalSession / PortalDriver seams (ADR-003).
//
// Auth detection is URL-based, never DOM-based (sii-py ADR-009): landing on
// LOGIN_HOST (zeusr.sii.cl) means not authenticated; any other host means we
// reached the destination. The Clave is typed by the user into SII's own page —
// it never crosses this boundary (cookies-only; ADR-006).
import type { Browser, BrowserContext, BrowserContextOptions, BrowserType, Page } from 'playwright';
import { LOGIN_HOST, loginUrl } from '../../config/index.js';
import { LoginFailedError } from '../../errors/index.js';
import { parseSiiLoginError } from '../../auth/login-error.js';
import { charsetOf, formLoginWallError, nonJsonResponseError } from './response.js';
import type {
  CredentialLoginOptions,
  FormRequest,
  InteractiveLoginOptions,
  JsonRequest,
  PortalDriver,
  PortalSession,
  PublicRequest,
  PublicResponse,
} from '../../seams/index.js';

/** Lazy-load playwright — an OPTIONAL peer since ADR-016. Only the launch paths of
 *  this default driver need it, so a consumer that injects its own PortalDriver (or
 *  only uses the pure barrel) never pays the module. A missing install fails HERE,
 *  at first actual use, with an actionable message — never at library import time.
 *  Only the not-found case for 'playwright' itself is translated; any other failure
 *  (a broken transitive import, etc.) propagates untouched. */
async function loadChromium(): Promise<BrowserType> {
  try {
    return (await import('playwright')).chromium;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const notFound = code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
    if (notFound && err instanceof Error && err.message.includes('playwright')) {
      throw new Error(
        'El PortalDriver por defecto necesita `playwright` (peer opcional, ADR-016). ' +
          'Instálalo en el proyecto consumidor: `npm i playwright` y luego ' +
          '`npx playwright install chromium`.',
      );
    }
    throw err;
  }
}

/** Extract SII's verbatim login-error message from the failed-login page (rendered
 *  on zeusr.sii.cl at /cgi_AUT2000/CAutInicio.cgi). Observed 2026-06-28: the page
 *  shows "<causa>" then "El código de este mensaje es <código>" — the line BEFORE
 *  the código line is the human cause (e.g. "La Clave Tributaria ingresada no es
 *  correcta…"). Pass it through unchanged (CONVENTIONS); fall back to a clear,
 *  no-retry message if the page shape changed. */
async function readLoginError(page: Page): Promise<string> {
  const fallback =
    'El SII rechazó el login (Clave incorrecta o cuenta bloqueada). NO reintentes a ciegas: ' +
    'varios intentos fallidos bloquean la cuenta. Verifica tu Clave o usa `sii auth login`.';
  try {
    // Pull the rendered body text and parse in Node (testable; keeps the DOM out
    // of core). The string expr returns a string, so the boundary cast is safe.
    const body = (await page.evaluate(
      '(document.body && document.body.innerText) || ""',
    )) as string;
    return parseSiiLoginError(body) ?? fallback;
  } catch {
    return fallback;
  }
}

/** A session owns its browser; close() tears the whole instance down. */
class PlaywrightPortalSession implements PortalSession {
  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  async goto(url: string): Promise<string> {
    // domcontentloaded is enough: SII serves its state as inline scripts
    // (e.g. DatosCntrNow), which have executed by this point.
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    return this.page.url();
  }

  async evaluate<T>(expression: string): Promise<T> {
    return (await this.page.evaluate(expression)) as T;
  }

  async requestJson(url: string, options: JsonRequest = {}): Promise<unknown> {
    // Issue from the browser's APIRequestContext so the session cookies ride along
    // (the SDI facades on www4.sii.cl authorize by the SPA session). domcontentloaded
    // is irrelevant here — this is a raw XHR-equivalent, not a navigation.
    const response = await this.context.request.fetch(url, {
      method: options.method ?? 'POST',
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.body !== undefined ? { data: JSON.stringify(options.body) } : {}),
    });
    try {
      return await response.json();
    } catch {
      // A non-JSON body from an authenticated SDI POST means the dead session was
      // bounced to SII's login wall — surface an actionable SessionExpiredError, not a
      // parse error. No extra round-trip: this first SDI POST IS the liveness test.
      // Classification is a pure helper so it is unit-tested (nonJsonResponseError).
      throw nonJsonResponseError(
        response.url(),
        response.headers()['content-type'] ?? '',
        response.status(),
      );
    }
  }

  async requestForm(url: string, options: FormRequest = {}): Promise<PublicResponse> {
    // Authenticated x-www-form-urlencoded POST from the browser's APIRequestContext,
    // so the session cookies ride along (the legacy TMBECN_* emit CGIs on loa.sii.cl
    // authorize by the SSO cookie). The response is HTML by design, so — unlike
    // requestJson — a non-JSON body is NOT a login wall; a dead session is detected
    // URL-based (the request bounced to LOGIN_HOST). `form` sets the urlencoded body
    // + content-type automatically (Playwright).
    const response = await this.context.request.fetch(url, {
      method: options.method ?? 'POST',
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.form ? { form: options.form } : {}),
    });
    const wall = formLoginWallError(response.url());
    if (wall) throw wall;
    const buffer = await response.body();
    const text = new TextDecoder(charsetOf(response.headers()['content-type'])).decode(buffer);
    return { status: response.status(), body: text };
  }

  async cookie(url: string, name: string): Promise<string | null> {
    const cookies = await this.context.cookies(url);
    return cookies.find((c) => c.name === name)?.value ?? null;
  }

  async storageState(): Promise<unknown> {
    // Cookies-only (ADR-006): drop localStorage/origins before persisting so no
    // page-scoped data ever lands on disk.
    const state = await this.context.storageState();
    return { cookies: state.cookies };
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

export class PlaywrightPortalDriver implements PortalDriver {
  async interactiveLogin(options: InteractiveLoginOptions): Promise<PortalSession> {
    // HEADED: the user must see and type into SII's real Clave Tributaria page.
    const chromium = await loadChromium();
    const browser = await chromium.launch({ headless: false });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(loginUrl(options.destination), { waitUntil: 'domcontentloaded' });
      // Login completes when the browser redirects OFF the login host. Window
      // close or timeout rejects (no partial session is ever written).
      await page.waitForURL((url) => url.hostname !== LOGIN_HOST, {
        timeout: options.timeoutMs,
      });
      return new PlaywrightPortalSession(browser, context, page);
    } catch {
      // Close the whole browser on ANY failure so a launched instance never leaks.
      await browser.close();
      throw new LoginFailedError(
        'Login no completado (tiempo agotado o ventana cerrada). Reintenta `sii auth login`.',
      );
    }
  }

  async credentialLogin(options: CredentialLoginOptions): Promise<PortalSession> {
    // HEADLESS (ADR-010): the user typed the Clave into the TERMINAL; we fill SII's
    // real login form and let its own JS derive the hidden rut/dv + referencia and
    // POST. We never hand-build the POST. The Clave is used only here — only cookies
    // are persisted by the caller. ONE attempt, never retried (account-lock safety,
    // ADR-004). Selectors observed 2026-06-28 (docs/sii-contract/auth-login.md):
    //   #rutcntr (full RUT, text) · #clave (password) · #bt_ingresar (submit).
    const chromium = await loadChromium();
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(loginUrl(options.destination), { waitUntil: 'domcontentloaded' });
      await page.fill('#rutcntr', options.rut);
      await page.fill('#clave', options.clave);
      // The submit POSTs to /cgi_AUT2000/CAutInicio.cgi (observed 2026-06-28). BOTH
      // outcomes are a navigation that settles into a document: success redirects OFF
      // the login host (→ Mi-SII); a rejected Clave / locked account stays ON
      // zeusr.sii.cl and RENDERS the error page there. Wait for the settled document
      // and decide by host — so a failure fails in seconds, never hanging to timeout.
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: options.timeoutMs }),
        page.click('#bt_ingresar'),
      ]);
      if (new URL(page.url()).hostname === LOGIN_HOST) {
        // Rejected — surface SII's verbatim message (CONVENTIONS); do NOT retry.
        throw new LoginFailedError(await readLoginError(page));
      }
      return new PlaywrightPortalSession(browser, context, page);
    } catch (err) {
      await browser.close();
      if (err instanceof LoginFailedError) throw err; // already carries SII's message
      throw new LoginFailedError(
        'Login con Clave por consola no completado (el formulario del SII no respondió ' +
          'o cambió). NO reintentes; usa `sii auth login` (navegador).',
      );
    }
  }

  async restore(storageState: unknown): Promise<PortalSession> {
    // HEADLESS: cookies-only readback for liveness / portal reads. No UI.
    const chromium = await loadChromium();
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        storageState: storageState as NonNullable<BrowserContextOptions['storageState']>,
      });
      const page = await context.newPage();
      return new PlaywrightPortalSession(browser, context, page);
    } catch (err) {
      // Don't leak the launched browser; surface the original error to the caller
      // (probeLive / statusRefresh treat a failed restore as "not live").
      await browser.close();
      throw err;
    }
  }

  async requestPublic(url: string, options: PublicRequest = {}): Promise<PublicResponse> {
    // UNAUTHENTICATED public consulta (ADR-014): a cold HTTP request — no browser, no
    // cookies, no session. Node's global fetch (undici) is the right tool; a public SII
    // CGI needs nothing Chromium provides (the Python original used a plain httpx POST,
    // and the endpoint requires no cookie / Referer / User-Agent — observed). Decode the
    // body per the response's DECLARED charset so Latin-1 accents survive (the palena
    // DTE report is ISO-8859-1, which a default UTF-8 decode would corrupt).
    const headers: Record<string, string> = { ...options.headers };
    let body: string | undefined;
    if (options.form) {
      body = new URLSearchParams(options.form).toString();
      headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
    }
    // Bound the request so a hung CGI fails loud instead of blocking the surface
    // indefinitely (ADR-004 "never hang"); 30s mirrors the ported Python timeout. On
    // timeout fetch rejects → the facade wraps it as DteError (no retry, ADR-004).
    const response = await fetch(url, {
      method: options.method ?? 'POST',
      headers,
      signal: AbortSignal.timeout(30_000),
      ...(body !== undefined ? { body } : {}),
    });
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder(charsetOf(response.headers.get('content-type'))).decode(buffer);
    return { status: response.status, body: text };
  }
}
