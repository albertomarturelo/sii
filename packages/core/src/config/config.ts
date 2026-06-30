// SII production hostnames — the single source of truth (ADR-004). Never
// hard-code a SII host anywhere else. Ported from first-hand observation in the
// Python sii-cli; prod-only, no env switch (sii-py ADR-016).

export const HOSTS = {
  /** Clave Tributaria login host. Landing here ⇒ NOT authenticated (URL-based detection). */
  login: 'https://zeusr.sii.cl',
  /** Login page path; takes the post-login destination as an UNKEYED query string (observed). */
  loginPath: '/AUT2000/InicioAutenticacion/IngresoRutClave.html',
  /** Server-side logout endpoint path; the close redirects OFF this path (sii-py, observed). */
  logoutPath: '/cgi_AUT2000/autTermino.cgi',
  /** Mi SII landing — serves the inline `DatosCntrNow` object with the contribuyente snapshot. */
  miSii: 'https://misiir.sii.cl/cgi_misii/siihome.cgi',
  portal: 'https://www.sii.cl',
  /** SPA JSON facades (RCV / F29 / F22) live under this host. */
  portalApi: 'https://www4.sii.cl',
  /** Legacy BHE/BTE consulta CGIs (boletas de honorarios). HTML skeleton filled
   *  client-side from inline JS maps; read via `PortalSession.goto`/`evaluate`, NOT
   *  the SDI-JSON facade. The `.sii.cl` session cookie SSO-carries here (observed
   *  2026-06-30). Session-keyed (`rut_arrastre` = the principal). (#20 / ADR-004) */
  bheCgi: 'https://loa.sii.cl/cgi_IMT',
  /** Palena: DTE SOAP web services AND the public, login-free consulta CGIs
   *  (e.g. `/cvc_cgi/dte/ee_empresa_rut` — empresas autorizadas a emitir DTE, ADR-014). */
  dteWs: 'https://palena.sii.cl',
  claveUnica: 'https://accounts.claveunica.gob.cl/openid/authorize/',
} as const;

/** URL hostname that indicates an unauthenticated session (sii-py ADR-009). */
export const LOGIN_HOST = 'zeusr.sii.cl';

/** Full login page URL (host + path). */
export const LOGIN_URL = `${HOSTS.login}${HOSTS.loginPath}`;

/** Full server-side logout URL (host + path). The close redirects OFF this path. */
export const LOGOUT_URL = `${HOSTS.login}${HOSTS.logoutPath}`;

export interface Settings {
  /** Max requests/second used to pace portal POSTs (sii-py ADR-011). */
  readonly rateLimitRps: number;
  /** Cookies-only session TTL hint, minutes. */
  readonly sessionTtlMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  rateLimitRps: 1,
  sessionTtlMinutes: 60,
};

/** Build the login URL: `<LOGIN_URL>?<destination>` — unkeyed query, observed format. */
export function loginUrl(destination: string): string {
  return `${LOGIN_URL}?${destination}`;
}
