// The Node default PortalDriver (ADR-006 / ADR-008): a Playwright/Chromium
// adapter. This is the ONLY module that imports Playwright — the core reaches the
// browser exclusively through the PortalSession / PortalDriver seams (ADR-003).
//
// Auth detection is URL-based, never DOM-based (sii-py ADR-009): landing on
// LOGIN_HOST (zeusr.sii.cl) means not authenticated; any other host means we
// reached the destination. The Clave is typed by the user into SII's own page —
// it never crosses this boundary (cookies-only; ADR-006).
import { chromium } from 'playwright';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { LOGIN_HOST, loginUrl } from '../../config/index.js';
import { LoginFailedError } from '../../errors/index.js';
import type { InteractiveLoginOptions, PortalDriver, PortalSession } from '../../seams/index.js';

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

  async restore(storageState: unknown): Promise<PortalSession> {
    // HEADLESS: cookies-only readback for liveness / portal reads. No UI.
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
}
