import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type Runtime } from '@albertomarturelo/sii-core';
import { connect, datos, toolText } from '../test-helpers.js';

// Synthetic institution rows (no SII, no PII) in the observed `/instituciones` wire shape.
const BLANK = { tipo: null, rut: null, vigenteDesde: null, vigenteHasta: null };
const LIST = [
  { enfinCodigo: '001', enfinDescripcion: 'Banco Sintético Uno', enfinAbreviacion: 'BSU' },
  { enfinCodigo: '042', enfinDescripcion: 'Cooperativa de Prueba', enfinAbreviacion: 'CDP' },
];

describe('@albertomarturelo/sii-mcp carpeta tools (in-memory client, fake runtime, no SII)', () => {
  it('carpeta_instituciones returns the curated live list as JSON (read-only, no args)', async () => {
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-09-11T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestText: () => JSON.stringify({ userId: '11111111-1', userAuthType: 'CT' }),
          requestJson: (url) => (url.endsWith('/instituciones') ? LIST : null),
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'carpeta_instituciones', arguments: {} });
    expect(JSON.parse(toolText(res))).toEqual([
      { codigo: '001', descripcion: 'Banco Sintético Uno', abreviacion: 'BSU', ...BLANK },
      { codigo: '042', descripcion: 'Cooperativa de Prueba', abreviacion: 'CDP', ...BLANK },
    ]);

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'carpeta_instituciones');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.inputSchema.properties ?? {}).toEqual({}); // session-keyed: no rut arg
  });

  it('carpeta_instituciones without a session is an error result carrying the message', async () => {
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-09-11T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({}),
    };
    const client = await connect(runtime);
    const res = await client.callTool({ name: 'carpeta_instituciones', arguments: {} });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(toolText(res)).toContain('sii auth login');
  });
});
