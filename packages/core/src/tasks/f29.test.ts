import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { F29Error, NotAuthenticatedError, ValidationError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { f29Formulario, f29Overview, f29Status } from './f29.js';

// Synthetic data (no SII, no real PII): persona 20.000.042-0, empresa 77.777.777-7.
const SELF = '20000042-0';
const EMPRESA = '77777777-7';

// Propuesta with códigos that map to known groups + an unknown one (→ otros) + PII (dropped).
const PROPUESTA_ENV = {
  metaData: { errors: null },
  data: {
    tipopropuesta: 40,
    estado: 0,
    descripcionEstado: null,
    listCodPropuestos: [
      { codigo: '503', valor: '1000000' }, // debitos (Facturas emitidas)
      { codigo: '538', valor: '190000' }, // debitos (TOTAL DÉBITOS)
      { codigo: '511', valor: '50000' }, // creditos (IVA doc electrónicos)
      { codigo: '537', valor: '50000' }, // creditos (TOTAL CRÉDITOS)
      { codigo: '151', valor: '30000' }, // retenciones (retención 10% honorarios)
      { codigo: '91', valor: '170000' }, // totales (TOTAL A PAGAR)
    ],
    listCodAdministrativos: [{ codigo: '9114', valor: '1' }], // unobserved → otros
    listCodBase: [{ codigo: '05', valor: 'PII NAME' }], // identity PII → dropped
    resultadoCalculoPP29: { traza: 'RUT[20000042] Periodo[202605]' }, // embeds RUT → dropped
  },
};
const ESTADO_ENV = {
  metaData: { errors: null },
  data: [
    {
      estadoDeclaracionId: 70,
      estado: 'Rechazada por pago inconcluso',
      folio: 1234567891,
      declFechaCreacion: '12/06/2026 10:30:00',
      monto: 880000,
      enNegocio: true,
    },
    {
      estadoDeclaracionId: 1,
      estado: 'Vigente',
      folio: 1234567890,
      declFechaCreacion: '12/06/2026 10:31:00',
      monto: 880000, // declared total a pagar → the month's headline `total`
      enNegocio: true,
    },
  ],
};

function makeRuntime(): Runtime {
  return {
    clock: new FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({
      restoreSession: {
        cookies: { TOKEN: 't' },
        requestJson: (url) => {
          if (url.includes('getDeclaracionConCondicionesYTipoPropuesta')) return PROPUESTA_ENV;
          if (url.includes('getDeclaracionConEstados')) return ESTADO_ENV;
          return { metaData: {}, data: null };
        },
      },
    }),
  };
}

async function seed(
  runtime: Runtime,
  accountType: 'persona' | 'empresa' = 'persona',
): Promise<void> {
  await writeSession(runtime.store, { rut: SELF, cookies: ['c'], savedAt: '2026-06-27T12:00:00Z' });
  await initOperateState(runtime.store, {
    selfRut: SELF,
    accountType,
    operable: [
      { rut: SELF, razonSocial: 'Juan Pérez', isSelf: true },
      { rut: EMPRESA, razonSocial: 'Mi Empresa SpA', isSelf: false },
    ],
  });
}

const entries = (rt: Runtime) => (rt.audit as RecordingAuditSink).entries;
const slept = (rt: Runtime) => (rt.clock as FixedClock).slept;

describe('f29 tasks (fakes, no SII)', () => {
  it('f29Formulario labels + groups the propuesta códigos (PII dropped), audits', async () => {
    const rt = makeRuntime();
    await seed(rt);

    const f = await f29Formulario(rt, { periodo: '2026-05' });
    expect(f).toMatchObject({
      rut: SELF,
      periodo: '2026-05',
      fuente: 'propuesta',
      tienePropuesta: true,
    });
    expect(f.grupos.debitos.map((l) => l.codigo)).toEqual(['503', '538']);
    expect(f.grupos.creditos.map((l) => l.codigo)).toEqual(['511', '537']);
    expect(f.grupos.retenciones.map((l) => l.codigo)).toEqual(['151']);
    expect(f.grupos.totales.map((l) => l.codigo)).toEqual(['91']);
    // The 90xx/91xx administrativos (9114) are SII-internal control códigos → NOT grouped.
    expect(f.grupos.otros).toEqual([]);
    expect(JSON.stringify(f.grupos)).not.toContain('9114');
    // Glosa + signo come from the observed taxonomy.
    expect(f.grupos.debitos.find((l) => l.codigo === '538')).toMatchObject({
      glosa: 'TOTAL DÉBITOS',
      signo: '=',
      valor: 190000,
    });
    expect(JSON.stringify(f)).not.toContain('PII NAME'); // listCodBase never surfaces
    expect(JSON.stringify(f)).not.toContain('20000042]'); // traza RUT never surfaces
    expect(entries(rt).at(-1)).toMatchObject({ action: 'f29_formulario', result: 'ok', rut: SELF });
  });

  it('f29Status returns the presented-F29 records for self (total surfaced), audits', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const e = await f29Status(rt, { periodo: '2026-05' });
    expect(e).toMatchObject({ rut: SELF, periodo: '2026-05', tieneDeclaracion: true });
    expect(e.declaraciones.map((d) => d.estado)).toEqual([
      'Rechazada por pago inconcluso',
      'Vigente',
    ]);
    expect(e.declaraciones.find((d) => d.estado === 'Vigente')?.total).toBe(880000);
    expect(entries(rt).at(-1)).toMatchObject({ action: 'f29_estado', result: 'ok', rut: SELF });
  });

  it('f29Overview returns a per-month row across the range (vigente total), paced, audits', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const ov = await f29Overview(rt, { desde: '2026-04', hasta: '2026-06' });
    expect(ov).toMatchObject({ rut: SELF, desde: '2026-04', hasta: '2026-06' });
    expect(ov.meses.map((m) => m.periodo)).toEqual(['2026-04', '2026-05', '2026-06']); // chronological
    // Each month picks the VIGENTE declaración's total (not the rechazada one).
    expect(
      ov.meses.every((m) => m.estado === 'Vigente' && m.total === 880000 && m.folio === 1234567890),
    ).toBe(true);
    expect(slept(rt)).toEqual([1000, 1000]); // paced between the 3 months (2 gaps)
    expect(entries(rt).at(-1)).toMatchObject({ action: 'f29_overview', result: 'ok', rut: SELF });
  });

  it('f29Overview rejects an inverted range and an over-wide range (no session)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await expect(f29Overview(rt, { desde: '2026-06', hasta: '2026-01' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(f29Overview(rt, { desde: '2020-01', hasta: '2026-12' })).rejects.toBeInstanceOf(
      ValidationError,
    ); // > 36 months
    expect(entries(rt).some((e) => String(e.action).startsWith('f29_'))).toBe(false);
  });

  it('is session-keyed: a representing operate pointer is REJECTED up front (no session, no audit)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA); // pointer = empresa

    await expect(f29Formulario(rt, { periodo: '2026-05' })).rejects.toBeInstanceOf(F29Error);
    await expect(f29Status(rt, { periodo: '2026-05' })).rejects.toThrow('77.777.777-7');
    await expect(f29Overview(rt, { desde: '2026-01', hasta: '2026-03' })).rejects.toBeInstanceOf(
      F29Error,
    );
    expect(entries(rt).some((e) => String(e.action).startsWith('f29_'))).toBe(false);
    // razón social is PII and must NOT leak.
    await expect(f29Formulario(rt, { periodo: '2026-05' })).rejects.not.toThrow('Mi Empresa SpA');
  });

  it('propuesta data:null → tienePropuesta false (empty groups)', async () => {
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestJson: () => ({ metaData: { errors: null }, data: null }),
        },
      }),
    };
    await seed(rt);
    const f = await f29Formulario(rt, { periodo: '2026-05' });
    expect(f.tienePropuesta).toBe(false);
    expect(Object.values(f.grupos).every((g) => g.length === 0)).toBe(true);
  });

  it('no session → NotAuthenticated with a failed audit', async () => {
    const rt = makeRuntime(); // not seeded
    await expect(f29Formulario(rt, { periodo: '2026-05' })).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
    expect(entries(rt).at(-1)).toMatchObject({ action: 'f29_formulario', result: 'failed' });
  });

  it('a bad período fails fast (ValidationError) before any session/audit', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await expect(f29Formulario(rt, { periodo: 'nope' })).rejects.toBeInstanceOf(ValidationError);
    expect(entries(rt).some((e) => String(e.action).startsWith('f29_'))).toBe(false);
  });
});
