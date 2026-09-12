import { describe, it, expect } from 'vitest';
import { HOSTS, NotAuthenticatedError, testing, type Runtime } from '@albertomarturelo/sii-core';
import { datos, run, runJson } from '../test-helpers.js';

// Synthetic institution rows (no SII, no PII) in the observed `/instituciones` wire shape.
const BLANK = { tipo: null, rut: null, vigenteDesde: null, vigenteHasta: null };
const LIST = [
  { enfinCodigo: '001', enfinDescripcion: 'Banco Sintético Uno', enfinAbreviacion: 'BSU' },
  { enfinCodigo: '042', enfinDescripcion: 'Cooperativa de Prueba', enfinAbreviacion: 'CDP' },
];

describe('sii carpeta command (fake runtime, no SII)', () => {
  function makeRuntime(list: unknown): Runtime {
    return {
      clock: new testing.FixedClock(new Date('2026-09-11T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestText: () => JSON.stringify({ userId: '11111111-1', userAuthType: 'CT' }),
          requestJson: (url) => (url.endsWith('/instituciones') ? list : null),
        },
      }),
    };
  }

  it('carpeta instituciones (--human) prints a code / abbreviation / description table', async () => {
    const rt = makeRuntime(LIST);
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'carpeta', 'instituciones', '--human');
    expect(out).toContain('lista vigente del SII');
    expect(out).toMatch(/001\s+BSU\s+Banco Sintético Uno/);
    expect(out).toMatch(/042\s+CDP\s+Cooperativa de Prueba/);
    expect(out).toContain('2 institución(es).');
  });

  it('carpeta instituciones emits the curated array as JSON by default (pipeable)', async () => {
    const rt = makeRuntime(LIST);
    await run(rt, 'auth', 'login');
    const json = await runJson(rt, 'carpeta', 'instituciones');
    expect(json).toEqual([
      { codigo: '001', descripcion: 'Banco Sintético Uno', abreviacion: 'BSU', ...BLANK },
      { codigo: '042', descripcion: 'Cooperativa de Prueba', abreviacion: 'CDP', ...BLANK },
    ]);
  });

  it('an empty live list is a clean "no rows" (not an error)', async () => {
    const rt = makeRuntime([]);
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'carpeta', 'instituciones', '--human');
    expect(out).toContain('El SII no devolvió instituciones.');
  });

  it('requires a session (NotAuthenticated)', async () => {
    const rt = makeRuntime(LIST); // no login
    await expect(run(rt, 'carpeta', 'instituciones')).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});
