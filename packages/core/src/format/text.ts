// SII text as SII meant it. Some endpoints serve DOUBLE-ENCODED text: the UTF-8 bytes of an
// already-mojibaked string, so even a correct decode yields "FundaciÃ³n" / "Ã‘uÃ±oa". Observed on
// the DTE borradores (`listaBorrador`, 2026-09-08), one F22 terceros title (2026-10-21) and the
// F22 estado glosas and historial glosas (2026-11-09, GH-264). Hoisted here after the third
// facade needed it (conventions/sii-wire.md). Display-side only: nothing sent to SII passes here.

/** Repair SII's double-encoded text by re-encoding the decoded string as Latin-1 and decoding it
 *  as UTF-8 again. Applied ONLY when the string carries the tell-tale `Ã`/`Â` + continuation pair,
 *  holds nothing above U+00FF, and the round trip decodes cleanly, so legitimately-accented text
 *  is left untouched. */
export function repairMojibake(v: string): string {
  if (!/[\u00c2-\u00c3][\u0080-\u00bf]/.test(v)) return v;
  const codes = Array.from(v, (ch) => ch.charCodeAt(0));
  if (codes.some((c) => c > 0xff)) return v; // a non-Latin-1 char ⇒ not a mojibake string
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(codes));
    return decoded.includes('\ufffd') ? v : decoded;
  } catch {
    return v; // not valid UTF-8 once re-encoded ⇒ leave the original alone
  }
}

/** A wire value as text, repaired: null stays null, anything else is `String(v)` through
 *  `repairMojibake`. For the free-text fields a facade curates (glosas, descripciones). */
export const repairedText = (v: unknown): string | null =>
  v === null || v === undefined ? null : repairMojibake(String(v));
