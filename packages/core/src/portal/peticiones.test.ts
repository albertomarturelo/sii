import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import type { TextRequest } from '../seams/index.js';
import { PeticionesError } from '../errors/index.js';
import { Rut } from '../rut/index.js';
import { fetchPeticiones } from './peticiones.js';
import { encodeEx, encodeOk, type PetSpec } from './__fixtures__/gwt-encode.js';

// Synthetic data only (no SII, no real PII): subject RUT 20.000.042-0.
const RUT = Rut.parse('20000042-0');

const T = (iso: string): number => new Date(iso).getTime();

const ONE_PETITION: PetSpec[] = [
  {
    numero: 900123,
    materiaGlosa: 'Solicitud sintética de prueba',
    estados: [
      // out of chronological order to exercise the sort (latest first)
      { glosa: 'Petición Recepcionada por el SII', fechaMs: T('2026-01-10T09:00:00Z') },
      {
        glosa: 'Peticion en espera de Antecedentes',
        fechaMs: T('2026-01-20T09:00:00Z'),
        nota: 'Falta adjuntar documento sintético.',
      },
      // functionary PII in the label must be stripped
      {
        glosa: 'Petición Asignada para Revisión (Subrogancia Informal [NOMBRE SINTETICO])',
        fechaMs: T('2026-01-15T09:00:00Z'),
      },
    ],
  },
];

const sessionReturning = (fn: (url: string, opts?: TextRequest) => string) =>
  new FakePortalSession({ requestText: (url, opts) => fn(url, opts) });

describe('peticiones facade (fakes, no SII)', () => {
  it('decodes + curates a petition: numero, materia, timeline (latest-first), PII stripped', async () => {
    const session = sessionReturning((url) =>
      url.endsWith('/peticion') ? encodeOk(ONE_PETITION) : '',
    );
    const res = await fetchPeticiones(session, { rut: RUT });

    expect(res.rut).toBe('20000042-0');
    expect(res.peticiones).toHaveLength(1);
    const p = res.peticiones[0]!;
    expect(p.numero).toBe(900123);
    expect(p.materia).toBe('Solicitud sintética de prueba');
    // sorted latest-first: espera (20th) > revisión (15th) > recepcionada (10th)
    expect(p.timeline.map((e) => e.estado)).toEqual([
      'Peticion en espera de Antecedentes',
      'Petición Asignada para Revisión', // functionary suffix stripped
      'Petición Recepcionada por el SII',
    ]);
    expect(p.estadoActual).toBe('Peticion en espera de Antecedentes');
    expect(p.timeline[0]!.mensaje).toBe('Falta adjuntar documento sintético.');
    expect(p.timeline[0]!.fecha).toBe('2026-01-20T09:00:00.000Z');
    expect(p.timeline[1]!.mensaje).toBeNull();
  });

  it('sends a cold GWT-RPC POST with the module base header + body-RUT', async () => {
    const session = sessionReturning((url) => (url.endsWith('/peticion') ? encodeOk([]) : ''));
    await fetchPeticiones(session, { rut: RUT });
    const req = session.lastTextRequest!;
    expect(req.url).toContain('/sispadinternet/peticion');
    expect(req.options?.method).toBe('POST');
    expect(req.options?.headers?.['X-GWT-Module-Base']).toContain('sispadinternet');
    // rut body (20000042) rides the request; the token is a placeholder
    expect(req.options?.body).toContain('|20000042|');
    expect(req.options?.body).toMatch(/^5\|0\|7\|/);
  });

  it('returns an empty list for a taxpayer with no petitions (not an error)', async () => {
    const session = sessionReturning(() => encodeOk([]));
    const res = await fetchPeticiones(session, { rut: RUT });
    expect(res.peticiones).toEqual([]);
  });

  it('surfaces a //EX business error verbatim as PeticionesError', async () => {
    const session = sessionReturning(() => encodeEx('El contribuyente no tiene acceso a SISPAD.'));
    await expect(fetchPeticiones(session, { rut: RUT })).rejects.toThrow(PeticionesError);
    await expect(fetchPeticiones(session, { rut: RUT })).rejects.toThrow(
      /no tiene acceso a SISPAD/,
    );
  });

  it('fails loud ("scraper roto") on an unexpected non-//OK body', async () => {
    const session = sessionReturning(() => '<html>login</html>');
    await expect(fetchPeticiones(session, { rut: RUT })).rejects.toThrow(/scraper roto/);
  });

  it('self-heals a rotated policy hash: re-sources from the permutation JS and retries', async () => {
    const NEW_HASH = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const PERM = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    let peticionCalls = 0;
    const session = sessionReturning((url, opts) => {
      if (url.endsWith('/sispadinternet.nocache.js')) return `select('${PERM}')`;
      if (url.endsWith(`${PERM}.cache.html`)) return `var POc='${NEW_HASH}'`;
      if (url.endsWith('/peticion')) {
        peticionCalls++;
        // stale (last-known) hash is rejected; only the re-sourced NEW_HASH deserializes
        return opts?.body?.includes(NEW_HASH)
          ? encodeOk(ONE_PETITION)
          : encodeEx('IncompatibleRemoteServiceException: policy not found');
      }
      return '';
    });
    const res = await fetchPeticiones(session, { rut: RUT });
    expect(res.peticiones).toHaveLength(1);
    expect(peticionCalls).toBe(2); // one rejected, one healed
  });
});
