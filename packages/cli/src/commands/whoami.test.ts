import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type Runtime } from '@albertomarturelo/sii-core';
import { run, runJson, seed } from '../test-helpers.js';

// Persona DatosCntrNow WITH email — whoami surfaces razón social/nombre + email.
// Synthetic, Mod-11-valid RUT 11.111.111-1 (CONVENTIONS).
const datos = (): unknown => ({
  contribuyente: {
    rut: 11111111,
    dv: '1',
    nombres: 'Juan',
    apellidoPaterno: 'Pérez',
    eMail: 'juan@example.cl',
    fechaInicioActividades: '2020-05-04 00:00:00.0',
    fechaTerminoGiro: null,
    autorizadoDeclararDia20: 'S',
  },
  atributos: [
    {
      atrCodigo: 'SGPE',
      fechaInicio: '04-05-2020',
      valor: 'Tipo contribuyente=1 y Categoría Contribuyente = 2',
    },
  ],
});

function makeRuntime(): Runtime {
  return {
    clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
      restoreSession: { landingUrl: HOSTS.miSii, evaluate: datos },
    }),
  };
}

describe('sii whoami command (fake runtime, no SII)', () => {
  it('whoami --human shows RUT, tipo, nombre and email of the authenticated account', async () => {
    const rt = makeRuntime();
    await seed(rt); // seed the session
    const out = await run(rt, 'whoami');
    expect(out).toContain('11.111.111-1');
    expect(out).toContain('Nombre: Juan Pérez');
    expect(out).toContain('Email: juan@example.cl');
    // The regime (#257); unknown reads «—», never an assumed value.
    expect(out).toContain('Inicio de actividades: 2020-05-04');
    expect(out).toContain('Término de giro:       —');
    expect(out).toContain('F29 todos los meses desde: —');
    expect(out).toContain('Segunda categoría:     sí');
    expect(out).toContain('Día de vencimiento F29: 20');
  });

  it('whoami emits the curated JSON by default', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const json = (await runJson(rt, 'whoami')) as {
      rut: string;
      accountType: string;
      nombre: string | null;
      email: string | null;
    };
    expect(json).toMatchObject({
      rut: '11111111-1',
      accountType: 'persona',
      nombre: 'Juan Pérez',
      email: 'juan@example.cl',
      regimen: {
        inicioActividades: '2020-05-04',
        terminoGiro: null,
        obligadoF29Desde: null,
        segundaCategoria: true,
        diaF29: 20,
      },
    });
  });
});
