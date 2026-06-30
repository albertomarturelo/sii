import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HOSTS, testing, type Runtime } from '@altumstack/sii-core';
import { buildServer } from './server.js';

// Synthetic, Mod-11-valid RUT (CONVENTIONS): 11.111.111-1.
const datos = (): unknown => ({
  contribuyente: { rut: 11111111, dv: '1', nombres: 'Juan', apellidoPaterno: 'Pérez' },
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

/** Wire a real MCP Client to the server over a linked in-memory transport. */
async function connect(runtime: Runtime): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildServer(runtime).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

// The SDK result `content`/`contents` items are typed unions (text | image | …);
// narrow to the text payload for assertions.
const toolText = (res: unknown): string =>
  (res as { content?: { text?: string }[] }).content?.[0]?.text ?? '';

const resourceText = (res: unknown): string =>
  (res as { contents?: { text?: string }[] }).contents?.[0]?.text ?? '';

const isError = (res: unknown): boolean => (res as { isError?: boolean }).isError === true;

const propKeys = (schema: unknown): string[] =>
  Object.keys((schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {});

describe('@sii/mcp server (in-memory client, fake runtime, no SII)', () => {
  it('exposes the auth/identity tools — and auth_login takes NO password', async () => {
    const client = await connect(makeRuntime());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'auth_login',
      'auth_logout',
      'auth_status',
      'bte_list',
      'dte_authorized',
      'f22_formulario',
      'f22_historial',
      'f22_observaciones',
      'f22_status',
      'f29_formulario',
      'f29_overview',
      'f29_status',
      'operate',
      'rcv_list',
      'rcv_summary',
    ]);

    // ADR-006: no tool INPUT FIELD accepts a password (descriptions may mention
    // "Clave" — that's fine; we inspect the input-schema property names only).
    const allInputKeys = tools.flatMap((t) => propKeys(t.inputSchema));
    expect(allInputKeys.some((k) => /password|clave/i.test(k))).toBe(false);
    // auth_login has no input fields at all (it delegates to the browser flow).
    expect(propKeys(tools.find((t) => t.name === 'auth_login')?.inputSchema)).toEqual([]);
    // auth_status surfaces the refresh flag (the first zod input schema, ADR-011).
    expect(propKeys(tools.find((t) => t.name === 'auth_status')?.inputSchema)).toContain('refresh');
  });

  it('exposes the orientation resources', async () => {
    const client = await connect(makeRuntime());
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      'sii://config',
      'sii://operable',
      'sii://operating',
      'sii://session',
    ]);
    const cfg = await client.readResource({ uri: 'sii://config' });
    expect(resourceText(cfg)).toContain(HOSTS.login);
  });

  it('auth_status reports not-authenticated before login', async () => {
    const client = await connect(makeRuntime());
    const res = await client.callTool({ name: 'auth_status', arguments: {} });
    expect(toolText(res)).toContain('No autenticado');
  });

  it('auth_login mints a session, then auth_status + sii://session reflect it', async () => {
    const runtime = makeRuntime();
    const client = await connect(runtime);

    expect(toolText(await client.callTool({ name: 'auth_login', arguments: {} }))).toContain(
      'Sesión iniciada como 11.111.111-1.',
    );
    expect(toolText(await client.callTool({ name: 'auth_status', arguments: {} }))).toContain(
      'Autenticado (sesión local) como 11.111.111-1.',
    );
    const session = await client.readResource({ uri: 'sii://session' });
    expect(resourceText(session)).toContain('11111111-1');
    const operable = await client.readResource({ uri: 'sii://operable' });
    expect(resourceText(operable)).toContain('11111111-1'); // self in the operable set
  });

  it('auth_logout takes no input and ends the session (server + local)', async () => {
    const runtime = makeRuntime();
    const client = await connect(runtime);

    // No input fields — it delegates to the logout task, carries no secret (ADR-006).
    const { tools } = await client.listTools();
    expect(propKeys(tools.find((t) => t.name === 'auth_logout')?.inputSchema)).toEqual([]);

    await client.callTool({ name: 'auth_login', arguments: {} });
    // The fake lands off the logout host → serverClosed=true; pin the exact mapped
    // string so the branch that ran is unambiguous (the false-branch mapping is
    // trivial and is core's concern — see auth.test.ts).
    expect(toolText(await client.callTool({ name: 'auth_logout', arguments: {} }))).toBe(
      'Sesión cerrada (servidor y local).',
    );
    // After logout the local session is gone → auth_status reports not-authenticated.
    expect(toolText(await client.callTool({ name: 'auth_status', arguments: {} }))).toContain(
      'No autenticado',
    );
  });

  it('auth_logout with no live session reports nothing to close', async () => {
    const client = await connect(makeRuntime());
    expect(toolText(await client.callTool({ name: 'auth_logout', arguments: {} }))).toContain(
      'No había sesión activa.',
    );
  });

  it('operate reports the context and selects self', async () => {
    const runtime = makeRuntime();
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });
    expect(toolText(await client.callTool({ name: 'operate', arguments: {} }))).toContain(
      'Operando como tú mismo: 11.111.111-1.',
    );
    expect(
      toolText(await client.callTool({ name: 'operate', arguments: { self: true } })),
    ).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate list=true lists the operable set (self/current markers)', async () => {
    const client = await connect(makeRuntime());
    // No session → actionable hint, no throw.
    expect(
      toolText(await client.callTool({ name: 'operate', arguments: { list: true } })),
    ).toContain('No hay sesión activa. Usa la tool auth_login.');
    await client.callTool({ name: 'auth_login', arguments: {} });
    const listed = toolText(await client.callTool({ name: 'operate', arguments: { list: true } }));
    expect(listed).toContain('11.111.111-1');
    expect(listed).toContain('tú mismo');
    expect(listed).toContain('operando ahora');
  });

  it('auth_status refresh=true reads the identity from the portal', async () => {
    const client = await connect(makeRuntime());
    await client.callTool({ name: 'auth_login', arguments: {} });
    const text = toolText(
      await client.callTool({ name: 'auth_status', arguments: { refresh: true } }),
    );
    expect(text).toContain('11.111.111-1');
    expect(text).toContain('Juan Pérez');
    expect(text).toContain('persona');
  });

  it('operate by a rut in the operable set selects it; outside it errors (isError)', async () => {
    const client = await connect(makeRuntime());
    await client.callTool({ name: 'auth_login', arguments: {} });
    // self IS operable → selects it.
    expect(
      toolText(await client.callTool({ name: 'operate', arguments: { rut: '11111111-1' } })),
    ).toContain('Operando como tú mismo: 11.111.111-1.');
    // A valid RUT NOT in the operable set → domain error surfaced as isError.
    const res = await client.callTool({ name: 'operate', arguments: { rut: '12345670-K' } });
    expect(isError(res)).toBe(true);
    expect(toolText(res).length).toBeGreaterThan(0); // SII/domain message passed through
  });

  it('rcv_summary returns the curated resumen as JSON (body-RUT, read-only)', async () => {
    const env = {
      respEstado: { codRespuesta: 0 },
      totDocRes: 2,
      data: [
        {
          rsmnTipoDocInteger: 33,
          dcvNombreTipoDoc: 'Factura',
          rsmnTotDoc: 2,
          rsmnMntTotal: 119000,
        },
      ],
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestJson: () => env,
          cookies: { TOKEN: 't' },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'rcv_summary', arguments: { periodo: '2026-06' } });
    const parsed = JSON.parse(toolText(res)) as {
      side: string;
      periodo: string;
      rows: { codigoTipoDoc: string }[];
    };
    expect(parsed).toMatchObject({ side: 'COMPRA', periodo: '2026-06' });
    expect(parsed.rows[0]?.codigoTipoDoc).toBe('33');
    // rcv_summary is read-only.
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'rcv_summary')?.annotations?.readOnlyHint).toBe(true);
  });

  it('f22_status returns the curated F22 estado as JSON (session-keyed, no PII códigos)', async () => {
    const busca = {
      metaData: { errors: [] },
      data: {
        decls: [{ folio: '999', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
        glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
      },
    };
    const grid = {
      metaData: {},
      data: [
        { codigo: '305', valor: '-100', glosa: 'Resultado' },
        { codigo: '3', valor: 'PII-MARKER-XYZ', glosa: 'RUT' }, // header PII → excluded
      ],
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? busca
              : url.includes('f22Compacto')
                ? grid
                : { metaData: {}, data: null },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'f22_status', arguments: { anio: '2025' } });
    const parsed = JSON.parse(toolText(res)) as {
      anio: string;
      estado: string;
      codigos: { codigo: string }[];
    };
    expect(parsed).toMatchObject({ anio: '2025', estado: 'Vigente' });
    expect(parsed.codigos.map((c) => c.codigo)).toEqual(['305']); // header código excluded
    expect(toolText(res)).not.toContain('PII-MARKER-XYZ'); // the PII código value never surfaces
  });

  it('f22_status with folio but no anio is rejected (folio requires anio)', async () => {
    const client = await connect(makeRuntime());
    const res = await client.callTool({ name: 'f22_status', arguments: { folio: '123' } });
    expect(isError(res)).toBe(true);
    expect(toolText(res)).toContain('folio'); // verbatim validation message, not a silent drop
  });

  it('f22_formulario returns the complete form grouped (ingresos/deducciones/retenciones/resultado/otros, no PII)', async () => {
    const busca = {
      metaData: { errors: [] },
      data: {
        decls: [{ folio: '999', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
        glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
      },
    };
    const grid = {
      metaData: {},
      data: [
        { codigo: '110', valor: '3000000', glosa: 'Rentas honorarios' }, // ingreso
        { codigo: '494', valor: '900000', glosa: 'Gastos presuntos' }, // deducción
        { codigo: '198', valor: '300000', glosa: 'Retenciones' }, // retención
        { codigo: '158', valor: '380000', glosa: 'SUB TOTAL' }, // cálculo intermedio (#28)
        { codigo: '305', valor: '-100', glosa: 'Resultado' }, // resultado
        { codigo: '8865', valor: '1', glosa: 'Código Emisión' }, // non-PII unclassified → otros
        { codigo: '9920', valor: 'PII-ADDR-XYZ', glosa: 'Dirección Origen' }, // PII → excluded
      ],
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? busca
              : url.includes('f22Compacto')
                ? grid
                : { metaData: {}, data: null },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({
      name: 'f22_formulario',
      arguments: { anio: '2025' },
    });
    const parsed = JSON.parse(toolText(res)) as {
      grupos: {
        ingresos: { codigo: string }[];
        deducciones: { codigo: string }[];
        creditos: { codigo: string }[];
        calculo: { codigo: string }[];
        resultado: { codigo: string }[];
        otros: { codigo: string }[];
      };
    };
    expect(parsed.grupos.ingresos.map((c) => c.codigo)).toEqual(['110']);
    expect(parsed.grupos.deducciones.map((c) => c.codigo)).toEqual(['494']);
    expect(parsed.grupos.creditos.map((c) => c.codigo)).toEqual(['198']);
    expect(parsed.grupos.calculo.map((c) => c.codigo)).toEqual(['158']); // intermediate, not resultado
    expect(parsed.grupos.resultado.map((c) => c.codigo)).toEqual(['305']);
    expect(parsed.grupos.otros.map((c) => c.codigo)).toEqual(['8865']); // non-PII, unmapped → shown
    expect(toolText(res)).not.toContain('PII-ADDR-XYZ'); // address PII never surfaces
  });

  it('f22_observaciones returns the observación list as JSON (código + glosa + url)', async () => {
    const busca = {
      metaData: { errors: [] },
      data: {
        decls: [{ folio: '999', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
        glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
      },
    };
    const obs = {
      data: [
        {
          codigo: 'B102',
          descripcion: 'Control ganancia de capital',
          url: 'http://www.sii.cl/B102.pdf',
        },
      ],
      respCod: null,
      errorMsg: null,
      metaData: { errors: null },
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? busca
              : url.includes('situacionObservacion')
                ? obs
                : { metaData: {}, data: null },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'f22_observaciones', arguments: { anio: '2025' } });
    const parsed = JSON.parse(toolText(res)) as {
      anio: string;
      observaciones: { codigo: string }[];
    };
    expect(parsed).toMatchObject({ anio: '2025' });
    expect(parsed.observaciones.map((o) => o.codigo)).toEqual(['B102']);
  });

  it('f22_historial returns the event timeline as JSON (most-recent-first)', async () => {
    const busca = {
      metaData: { errors: [] },
      data: {
        decls: [{ folio: '999', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
        glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
      },
    };
    const eventos = {
      data: [
        {
          folio: '999',
          codEvento: '48',
          nombre: 'Declaración recibida.',
          fechaEvento: '08/04/2025',
          tipoEvento: '0',
        },
        {
          folio: '999',
          codEvento: '2',
          nombre: 'Devolución autorizada.',
          fechaEvento: '16/04/2025',
          tipoEvento: '0',
        },
      ],
      respCod: 0,
      errorMsg: null,
      metaData: { errors: null },
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? busca
              : url.includes('buscaEventos')
                ? eventos
                : { metaData: {}, data: null },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'f22_historial', arguments: { anio: '2025' } });
    const parsed = JSON.parse(toolText(res)) as {
      anio: string;
      folios: string[];
      eventos: { codigo: string; fecha: string | null }[];
    };
    expect(parsed).toMatchObject({ anio: '2025', folios: ['999'] });
    expect(parsed.eventos.map((e) => e.codigo)).toEqual(['2', '48']); // most-recent-first
  });

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

  it('bte_list returns the month boletas as JSON (session-keyed, own-PII dropped)', async () => {
    const META = {
      total_boletas: '1',
      suma_liquido: '256500',
      nombre_contribuyente: 'PII-OWN-NAME-XYZ', // report meta → must not surface
    };
    const ARR = {
      nroboleta_1: '101',
      fechaemision_1: '15/05/2026',
      rutreceptor_1: '12345670',
      dvreceptor_1: 'K',
      nombrereceptor_1: 'Cliente Uno SpA',
      totalhonorarios_1: '300.000',
      honorariosliquidos_1: '256.500',
      estado_1: 'N',
    };
    // restoreSession.evaluate serves BOTH the login DatosCntrNow probe and the BTE inline maps.
    const evaluate = (expr: string): unknown =>
      expr.includes('arr_informe_mensual') ? ARR : expr.includes('xml_values') ? META : datos();
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-30T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: { landingUrl: HOSTS.miSii, evaluate },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'bte_list', arguments: { periodo: '2026-05' } });
    const parsed = JSON.parse(toolText(res)) as {
      side: string;
      periodo: string;
      boletas: { folio: number; contraparteRut: string }[];
    };
    expect(parsed).toMatchObject({ side: 'EMITIDAS', periodo: '2026-05' });
    expect(parsed.boletas[0]).toMatchObject({ folio: 101, contraparteRut: '12345670-K' });
    expect(toolText(res)).not.toContain('PII-OWN-NAME-XYZ'); // own-identity meta never surfaces

    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'bte_list')?.annotations?.readOnlyHint).toBe(true);
  });

  it('f29_formulario returns the propuesta grouped + labeled as JSON (session-keyed, no PII)', async () => {
    const propuesta = {
      metaData: { errors: null },
      data: {
        tipopropuesta: 40,
        estado: 0,
        descripcionEstado: null,
        listCodPropuestos: [
          { codigo: '503', valor: '1000000' }, // debitos
          { codigo: '511', valor: '50000' }, // creditos
        ],
        listCodAdministrativos: [],
        listCodBase: [{ codigo: '05', valor: 'PII-MARKER-XYZ' }], // identity PII → dropped
      },
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('getDeclaracionConCondicionesYTipoPropuesta')
              ? propuesta
              : { metaData: {}, data: null },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({
      name: 'f29_formulario',
      arguments: { periodo: '2026-05' },
    });
    const parsed = JSON.parse(toolText(res)) as {
      periodo: string;
      fuente: string;
      tienePropuesta: boolean;
      grupos: { debitos: { codigo: string }[]; creditos: { codigo: string }[] };
    };
    expect(parsed).toMatchObject({ periodo: '2026-05', fuente: 'propuesta', tienePropuesta: true });
    expect(parsed.grupos.debitos.map((l) => l.codigo)).toEqual(['503']);
    expect(parsed.grupos.creditos.map((l) => l.codigo)).toEqual(['511']);
    expect(toolText(res)).not.toContain('PII-MARKER-XYZ'); // listCodBase never surfaces

    // f29_formulario is read-only.
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'f29_formulario')?.annotations?.readOnlyHint).toBe(true);
  });
});
