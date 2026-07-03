import { describe, it, expect } from 'vitest';
import { testing, type Runtime } from '@albertomarturelo/sii-core';
import { connect, toolText } from '../test-helpers.js';

describe('@albertomarturelo/sii-mcp dte tools (in-memory client, fake runtime, no SII)', () => {
  it('dte_authorized returns the curated public report as JSON — NO login required', async () => {
    const authorizedHtml = `
      <table>
        <tr><td>Rut</td><td>20.000.042-0</td></tr>
        <tr><td>Razon Social/Nombres</td><td>EMPRESA SINTETICA SPA</td></tr>
      </table>
      <table><tr><td>33</td><td>FACTURA ELECTRONICA</td><td>01-08-2014</td><td></td></tr></table>`;
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-29T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({ requestPublic: () => authorizedHtml }),
    };
    const client = await connect(runtime);

    // Called directly, with no auth_login first (public, session-less — ADR-014).
    const res = await client.callTool({ name: 'dte_authorized', arguments: { rut: '20000042-0' } });
    const parsed = JSON.parse(toolText(res)) as {
      rut: string;
      autorizado: boolean;
      documentos: { codigo: number }[];
    };
    expect(parsed).toMatchObject({ rut: '20000042-0', autorizado: true });
    expect(parsed.documentos.map((d) => d.codigo)).toEqual([33]);

    // dte_authorized is read-only.
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'dte_authorized')?.annotations?.readOnlyHint).toBe(true);
  });
});
