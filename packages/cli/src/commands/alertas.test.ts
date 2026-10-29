import { describe, it, expect } from 'vitest';
import {
  HOSTS,
  NotAuthenticatedError,
  ValidationError,
  testing,
  type JsonRequest,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { buildProgram } from '../program.js';
import { datos, run, runJson, seed } from '../test-helpers.js';

// Synthetic F29 estado rows (no SII, no PII): 2026-09 has nothing filed, 2026-08 a borrador
// never sent; every other período is Vigente.
function makeRuntime(): Runtime {
  return {
    clock: new testing.FixedClock(new Date(2026, 9, 23, 12)),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      restoreSession: {
        landingUrl: HOSTS.miSii,
        datos,
        cookies: { TOKEN: 't' },
        requestJson: (url: string, options?: JsonRequest) => {
          if (!url.includes('getDeclaracionConEstados')) return { metaData: {}, data: null };
          const d = (options?.body as { data: { mes: string; anno: string } }).data;
          const periodo = `${d.anno}-${d.mes}`;
          const rows =
            periodo === '2026-09'
              ? []
              : periodo === '2026-08'
                ? [
                    {
                      estadoDeclaracionId: 10,
                      estado: 'Guardada',
                      folio: 0,
                      declFechaCreacion: '05/09/2026',
                    },
                  ]
                : [{ estadoDeclaracionId: 1, estado: 'Vigente', folio: 100 }];
          return { metaData: { errors: null }, data: rows };
        },
      },
    }),
  };
}

describe('sii alertas command (fake runtime, no SII)', () => {
  it('emits the JSON contract by default', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const json = (await runJson(rt, 'alertas', '--fuentes', 'f29')) as {
      alertas: { id: string }[];
      fuentes: { origen: string; estado: string }[];
      incompleto: boolean;
    };
    expect(json.alertas.map((a) => a.id)).toEqual([
      'f29:2026-08:guardada',
      'f29:2026-09:sin_declarar',
    ]);
    expect(json.fuentes.map((f) => f.estado)).toEqual(['omitida', 'ok', 'omitida', 'omitida']);
    expect(json.incompleto).toBe(false);
  });

  it('--human lists each alerta with its date and both F29 due dates', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const out = await run(rt, 'alertas', '--fuentes', 'f29');
    expect(out).toContain('Alertas — 11.111.111-1');
    expect(out).toContain('2026-09-05  F29 2026-08  Guardada');
    expect(out).toContain('con pago venció el 2026-10-20, sin pago vence el 2026-10-28');
  });

  it('--desde reaches the task', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const json = (await runJson(rt, 'alertas', '--fuentes', 'f29', '--desde', '2026-10-01')) as {
      alertas: { id: string }[];
    };
    expect(json.alertas.map((a) => a.id)).toEqual(['f29:2026-09:sin_declarar']);
  });

  it('an unknown fuente is a validation error', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await expect(run(rt, 'alertas', '--fuentes', 'tgr')).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires a session', async () => {
    await expect(run(makeRuntime(), 'alertas')).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('declares its auth mode first and the cost of a full read (ADR-024 / ADR-030)', () => {
    const cmd = buildProgram(makeRuntime()).commands.find((c) => c.name() === 'alertas')!;
    expect(cmd.description().startsWith('Session-keyed')).toBe(true);
    expect(cmd.description()).toContain('~20 consultas');
    expect(cmd.options.map((o) => o.long)).toEqual(
      expect.arrayContaining(['--fuentes', '--desde']),
    );
    expect(cmd.options.map((o) => o.long)).not.toContain('--rut');
  });
});
