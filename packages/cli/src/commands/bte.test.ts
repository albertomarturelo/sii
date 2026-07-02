import { describe, it, expect } from 'vitest';
import { HOSTS, NotAuthenticatedError, testing, type Runtime } from '@altumstack/sii-core';
import { datos, run, runJson } from '../test-helpers.js';

describe('sii bte command (fake runtime, no SII)', () => {
  const META = { total_boletas: '1', suma_liquido: '256500', nombre_contribuyente: 'PII-OWN-XYZ' };
  const ARR = {
    nroboleta_1: '101',
    fechaemision_1: '15/05/2026',
    rutreceptor_1: '12345670',
    dvreceptor_1: 'K',
    nombrereceptor_1: 'Cliente Uno SpA',
    honorariosliquidos_1: '256.500',
    estado_1: 'N',
  };
  // restoreSession.evaluate serves BOTH the login DatosCntrNow probe and the BTE inline maps.
  const evaluate = (expr: string): unknown =>
    expr.includes('arr_informe_mensual') ? ARR : expr.includes('xml_values') ? META : datos();
  const makeBteRuntime = (): Runtime => ({
    clock: new testing.FixedClock(new Date('2026-06-30T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
      restoreSession: { landingUrl: HOSTS.miSii, evaluate },
    }),
  });

  it('bte list <periodo> prints the month boletas (EMITIDAS by default)', async () => {
    const rt = makeBteRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'bte', 'list', '2026-05');
    expect(out).toContain('BHE EMITIDAS 2026-05');
    expect(out).toContain('folio=101');
    expect(out).toContain('1 boleta(s)');
    expect(out).not.toContain('PII-OWN-XYZ'); // own-identity meta never prints
  });

  it('JSON default: bte list emits the curated object (no --rut concept)', async () => {
    const rt = makeBteRuntime();
    await run(rt, 'auth', 'login');
    const json = (await runJson(rt, 'bte', 'list', '2026-05', '--recibidas')) as {
      side: string;
      boletas: { folio: number }[];
    };
    expect(json.side).toBe('RECIBIDAS');
    expect(json.boletas.map((b) => b.folio)).toEqual([101]);
  });

  it('bte list requires a session (NotAuthenticated → exit 2)', async () => {
    await expect(run(makeBteRuntime(), 'bte', 'list', '2026-05')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });
});

describe('sii bte emit (fake runtime, no SII)', () => {
  const FORM =
    "<html><script>xml_values['dia_actual']='02';xml_values['mes_actual']='07';" +
    "xml_values['anio_actual']='2026';xml_values['comuna_ctr']='SANTIAGO';" +
    "xml_values['glosa_actividad']='SERV';</script><form name='formulario'>" +
    "<select name='cbo_domicilio'><option value='999' selected>x</option></select></form></html>";
  const CONFIRM =
    '<html><script>' +
    'xml_values[\'Monto_Boleta\']=formatMiles("1000000",".");' +
    'xml_values[\'Monto_Retencion\']=formatMiles("137500",".");' +
    'xml_values[\'Monto_Liquido\']=formatMiles("862500",".");' +
    "xml_values['PorcentajeRetencion']='13,75';</script><form name='formulario'>ok</form></html>";
  const RESULT = "<html><script>xml_values['cod_barras']='200000420000000123DD';</script>ok</html>";

  const requestForm = (url: string): string => {
    if (url.includes('ConfirmaTimbrajeContrib')) return CONFIRM;
    if (url.includes('BoletaHonorariosElectronica')) return RESULT;
    return FORM;
  };
  const makeEmitRuntime = (): Runtime => ({
    clock: new testing.FixedClock(new Date('2026-07-02T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
      restoreSession: { landingUrl: HOSTS.miSii, evaluate: datos, requestForm },
    }),
  });

  const EMIT_ARGS = [
    'bte',
    'emit',
    '--receptor',
    '12345670-K',
    '--nombre',
    'ACME SPA',
    '--domicilio',
    'Av 100',
    '--region',
    '13',
    '--comuna',
    '15103',
    '--linea',
    '1000000:Asesoría',
  ];

  it('--dry-run (default, no --confirm) previews WITHOUT issuing', async () => {
    const rt = makeEmitRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, ...EMIT_ARGS, '--human');
    expect(out).toContain('vista previa');
    expect(out).toContain('Líquido a recibir: 862.500');
    expect(out).toContain('NO se emitió');
    // audit shows a preview, never an emit.
    const actions = (rt.audit as testing.RecordingAuditSink).entries.map((e) => e.action);
    expect(actions).toContain('bte_emit_preview');
    expect(actions).not.toContain('bte_emit');
  });

  it('--confirm with the matching total issues and returns the código de barras', async () => {
    const rt = makeEmitRuntime();
    await run(rt, 'auth', 'login');
    const json = (await runJson(rt, ...EMIT_ARGS, '--confirm', '1000000')) as { codBarras: string };
    expect(json.codBarras).toBe('200000420000000123DD');
    expect((rt.audit as testing.RecordingAuditSink).entries.map((e) => e.action)).toContain(
      'bte_emit',
    );
  });

  it('--confirm with a MISMATCHED total aborts (never issues)', async () => {
    const rt = makeEmitRuntime();
    await run(rt, 'auth', 'login');
    await expect(run(rt, ...EMIT_ARGS, '--confirm', '999')).rejects.toThrow('no coincide');
    expect((rt.audit as testing.RecordingAuditSink).entries.map((e) => e.action)).not.toContain(
      'bte_emit',
    );
  });
});
