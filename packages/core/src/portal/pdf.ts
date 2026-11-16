// Shared check for a document download (ADR-022): success is the content-type plus the `%PDF`
// magic, never the HTTP status, since SII answers 200 for its own error pages too.

/** `content-type` says PDF AND the body starts with the `%PDF` magic. Status is never a
 *  success signal here — SII answers 200 for its own error page (ADR-022). */
export function isPdfBytes(bytes: Uint8Array, contentType: string | null): boolean {
  return (
    (contentType ?? '').toLowerCase().includes('application/pdf') &&
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}
