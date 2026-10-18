// In-house cookie jar for the HTTP PortalDriver (ADR-027). SII's session rides entirely
// on cookies (observed 2026-10-17: a plain `fetch` login sets TOKEN / CSESSIONID /
// NETSCAPE_LIVEWIRE.* via Set-Cookie and NOTHING is set by page JS), so a small, correct
// jar replaces Playwright's context for every non-JS surface.
//
// No third-party cookie library (ADR-004 posture + a narrow, observed need): the jar
// models only what SII uses — Set-Cookie with Domain / Path / Max-Age / Expires / Secure /
// HttpOnly on one registrable domain (.sii.cl and its sub-hosts). It (de)serialises to the
// SAME shape Playwright's `storageState().cookies` uses, so a jar minted over HTTP restores
// into the browser engine and vice-versa — the session file is engine-agnostic (ADR-027).

/** One cookie in Playwright's `storageState().cookies` shape — the persisted contract. */
export interface SerializedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Epoch SECONDS; `-1` for a session cookie (Playwright's convention). */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

interface JarCookie extends SerializedCookie {
  /** A cookie set WITHOUT a Domain attribute is host-only: it matches the exact host, never
   *  sub-domains (RFC 6265). `domain` holds the host either way; this flag keeps the split. */
  hostOnly: boolean;
}

const SESSION_EXPIRY = -1;

export class CookieJar {
  // Keyed by name|domain|path (RFC 6265 cookie identity) so a re-Set overwrites in place.
  private readonly cookies = new Map<string, JarCookie>();

  /** Apply the `Set-Cookie` header lines from a response received for `requestUrl`.
   *  `setCookieLines` is what `Headers.getSetCookie()` returns (one unfolded line each). */
  applySetCookies(requestUrl: string, setCookieLines: readonly string[]): void {
    const reqUrl = new URL(requestUrl);
    for (const line of setCookieLines) this.applyOne(reqUrl, line);
  }

  private applyOne(reqUrl: URL, line: string): void {
    const [pair, ...attrParts] = line.split(';');
    if (pair === undefined) return;
    const eq = pair.indexOf('=');
    if (eq < 1) return; // no name — ignore
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();

    let domain = reqUrl.hostname.toLowerCase();
    let hostOnly = true;
    // Default path is the request path's directory (RFC 6265 §5.1.4, simplified).
    let path = defaultPath(reqUrl.pathname);
    let expires = SESSION_EXPIRY;
    let secure = false;
    let httpOnly = false;
    let sameSite: SerializedCookie['sameSite'] = 'Lax';
    let maxAgeDelete = false;

    for (const attr of attrParts) {
      const ieq = attr.indexOf('=');
      const key = (ieq < 0 ? attr : attr.slice(0, ieq)).trim().toLowerCase();
      const val = ieq < 0 ? '' : attr.slice(ieq + 1).trim();
      switch (key) {
        case 'domain':
          if (val) {
            domain = val.replace(/^\./, '').toLowerCase();
            hostOnly = false;
          }
          break;
        case 'path':
          if (val.startsWith('/')) path = val;
          break;
        case 'secure':
          secure = true;
          break;
        case 'httponly':
          httpOnly = true;
          break;
        case 'samesite':
          sameSite = normalizeSameSite(val);
          break;
        case 'max-age': {
          const secs = Number(val);
          if (Number.isFinite(secs)) {
            if (secs <= 0) maxAgeDelete = true;
            else expires = Math.floor(Date.now() / 1000) + secs;
          }
          break;
        }
        case 'expires': {
          const ms = Date.parse(val);
          if (!Number.isNaN(ms)) {
            if (ms <= Date.now()) maxAgeDelete = true;
            else expires = Math.floor(ms / 1000);
          }
          break;
        }
      }
    }

    const id = `${name}|${domain}|${path}`;
    // An empty value or a past Max-Age/Expires is a deletion (SII clears the classic jar
    // this way on logout / on the OAuth page). Drop the matching cookie.
    if (value === '' || maxAgeDelete) {
      this.cookies.delete(id);
      return;
    }
    this.cookies.set(id, {
      name,
      value,
      domain,
      path,
      expires,
      httpOnly,
      secure,
      sameSite,
      hostOnly,
    });
  }

  /** The `Cookie` request header value for `requestUrl` (matching cookies joined by `; `),
   *  or `null` when none match. Expired cookies are skipped (and evicted). */
  header(requestUrl: string): string | null {
    const url = new URL(requestUrl);
    const host = url.hostname.toLowerCase();
    const isHttps = url.protocol === 'https:';
    const nowSecs = Math.floor(Date.now() / 1000);
    const parts: string[] = [];
    for (const [id, c] of this.cookies) {
      if (c.expires !== SESSION_EXPIRY && c.expires <= nowSecs) {
        this.cookies.delete(id);
        continue;
      }
      if (c.secure && !isHttps) continue;
      if (!domainMatch(host, c.domain, c.hostOnly)) continue;
      if (!pathMatch(url.pathname, c.path)) continue;
      parts.push(`${c.name}=${c.value}`);
    }
    return parts.length ? parts.join('; ') : null;
  }

  /** Value of a single cookie visible to `requestUrl` (e.g. the SPA `TOKEN`), or null. */
  value(requestUrl: string, name: string): string | null {
    const url = new URL(requestUrl);
    const host = url.hostname.toLowerCase();
    for (const c of this.cookies.values()) {
      if (c.name !== name) continue;
      if (!domainMatch(host, c.domain, c.hostOnly)) continue;
      if (!pathMatch(url.pathname, c.path)) continue;
      return c.value;
    }
    return null;
  }

  /** The cookies-only storage state to persist (Playwright's shape, ADR-006/ADR-027). A
   *  non-host-only cookie is exported with a leading-dot `domain` — Playwright's convention
   *  for a shared cookie — so BOTH engines read the host-only/shared split back correctly. */
  toStorageState(): { cookies: SerializedCookie[] } {
    const cookies = [...this.cookies.values()].map(({ hostOnly, ...c }): SerializedCookie => ({
      ...c,
      domain: hostOnly ? c.domain : `.${c.domain}`,
    }));
    return { cookies };
  }

  /** Build a jar from a persisted storage state (either engine's). A leading-dot `domain`
   *  means a shared (non-host-only) cookie, a bare host means host-only — Playwright's
   *  convention. Tolerant of a missing `cookies` array (a garbage jar restores empty). */
  static fromStorageState(state: unknown): CookieJar {
    const jar = new CookieJar();
    const raw = (state as { cookies?: unknown } | null)?.cookies;
    if (!Array.isArray(raw)) return jar;
    for (const c of raw as Partial<SerializedCookie>[]) {
      if (typeof c?.name !== 'string' || typeof c.domain !== 'string') continue;
      const hostOnly = !c.domain.startsWith('.');
      const domain = c.domain.replace(/^\./, '').toLowerCase();
      const path = c.path ?? '/';
      jar.cookies.set(`${c.name}|${domain}|${path}`, {
        name: c.name,
        value: c.value ?? '',
        domain,
        path,
        expires: typeof c.expires === 'number' ? c.expires : SESSION_EXPIRY,
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? false,
        sameSite: normalizeSameSite(c.sameSite ?? 'Lax'),
        hostOnly,
      });
    }
    return jar;
  }
}

function defaultPath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/';
  const lastSlash = pathname.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash);
}

function domainMatch(host: string, cookieDomain: string, hostOnly: boolean): boolean {
  if (host === cookieDomain) return true;
  if (hostOnly) return false;
  return host.endsWith(`.${cookieDomain}`);
}

function pathMatch(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (requestPath.startsWith(cookiePath)) {
    return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
  }
  return false;
}

function normalizeSameSite(val: string): SerializedCookie['sameSite'] {
  const v = val.toLowerCase();
  if (v === 'strict') return 'Strict';
  if (v === 'none') return 'None';
  return 'Lax';
}
