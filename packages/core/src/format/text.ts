// SII text as SII meant it. Some endpoints serve DOUBLE-ENCODED text: the UTF-8 bytes of an
// already-mojibaked string, so even a correct decode yields "FundaciÃ³n" / "Ã‘uÃ±oa". Observed on
// the DTE borradores (`listaBorrador`, 2026-09-08), one F22 terceros title (2026-10-21) and the
// F22 estado and historial glosas (2026-11-09, GH-264) and the F22 código glosas (2026-11-10,
// GH-267, GH-271). Hoisted here after the third facade needed it (conventions/sii-wire.md).
// Display-side only: nothing sent to SII passes here.

// SII's double encoding is Windows-1252, not Latin-1 (GH-271): a UTF-8 byte in 0x80–0x9F was read
// as cp1252's printable character there, so « Ó » (C3 93) arrives as `Ã“` (U+201C). These are the
// characters cp1252 puts at 0x80–0x9F, in byte order; its five undefined bytes (81, 8D, 8F, 90, 9D)
// decode to the C1 control of the same value, which already is that byte.
const CP1252_HIGH =
  '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f' +
  '\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
const CP1252_BYTE = new Map(Array.from(CP1252_HIGH, (ch, i) => [ch, 0x80 + i]));

/** The byte a character stood for when SII decoded UTF-8 as cp1252; its code point otherwise. */
const cp1252Byte = (ch: string): number => CP1252_BYTE.get(ch) ?? ch.codePointAt(0) ?? 0;

/** Repair SII's double-encoded text by re-encoding the decoded string as Windows-1252 and decoding
 *  it as UTF-8 again. Applied ONLY when the string carries the tell-tale `Ã`/`Â` + continuation
 *  pair (the continuation byte in its Latin-1 or cp1252 form), holds nothing else beyond one byte,
 *  and the round trip decodes cleanly, so legitimately-accented text is left untouched. */
export function repairMojibake(v: string): string {
  const codes = Array.from(v, cp1252Byte);
  const tellTale = codes.some(
    (c, i) =>
      (c === 0xc2 || c === 0xc3) && (codes[i + 1] ?? 0) >= 0x80 && (codes[i + 1] ?? 0) <= 0xbf,
  );
  if (!tellTale) return v;
  if (codes.some((c) => c > 0xff)) return v; // a char that is no cp1252 byte ⇒ not a mojibake string
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
