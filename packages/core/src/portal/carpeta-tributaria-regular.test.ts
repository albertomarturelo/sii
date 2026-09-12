import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import type { PublicResponse } from '../seams/index.js';
import {
  CarpetaError,
  SessionExpiredError,
  UnexpectedResponseError,
  Www2SessionError,
} from '../errors/index.js';
import {
  fetchInstituciones,
  listInstituciones,
  resolveInstitucion,
} from './carpeta-tributaria-regular.js';

// Synthetic data only (no SII, no real PII): app-session userId 20000042-0; invented institutions.
const USER_ID = '20000042-0';
const APP = { userId: USER_ID, userAuthType: null };
// The observed session JSON shape (2026-09-12), synthetic values.
const STATUS_OK = JSON.stringify({
  seconds: 5999,
  userId: USER_ID,
  userProfiles: ['00000'],
  userAuthType: 'CT',
  authTime: 1789000000000,
  userRte: USER_ID,
});
// The observed 8-key row shape (2026-09-12), synthetic institutions + Mod-11-valid RUTs.
const LIST = [
  {
    enfinCodigo: '001',
    enfinDescripcion: 'Banco Sintético Uno',
    enfinAbreviacion: 'BSU',
    enfinFechaVigDesde: '2016-04-03',
    enfinFechaVigHasta: null,
    enfinTipo: 3,
    enfinRutInstitucion: 77777777,
    enfinDvInstitucion: '7',
  },
  { enfinCodigo: '042', enfinDescripcion: 'Cooperativa de Prueba', enfinAbreviacion: '' },
  { enfinCodigo: '1005', enfinDescripcion: 'Otra institución', extra: 'unobserved-field' },
];
const BLANK = { tipo: null, rut: null, vigenteDesde: null, vigenteHasta: null };

/** A session that logs every seam call in order, so the session-read ordering is assertable. */
function scripted(opts: { instituciones?: unknown; status?: PublicResponse | string } = {}) {
  const calls: string[] = [];
  const session = new FakePortalSession({
    requestText: (url) => {
      calls.push(`text ${url}`);
      return opts.status ?? STATUS_OK;
    },
    requestJson: (url) => {
      calls.push(`json ${url}`);
      return url.endsWith('/instituciones') ? (opts.instituciones ?? LIST) : null;
    },
  });
  return { session, calls };
}

describe('carpeta instituciones facade (fake session, no SII)', () => {
  it('projects the observed enfin* keys into curated rows; blanks → null; extras tolerated', async () => {
    const { session } = scripted();
    const res = await fetchInstituciones(session, APP);
    expect(res).toEqual([
      {
        codigo: '001',
        descripcion: 'Banco Sintético Uno',
        abreviacion: 'BSU',
        tipo: 3,
        rut: '77777777-7',
        vigenteDesde: '2016-04-03',
        vigenteHasta: null,
      },
      { codigo: '042', descripcion: 'Cooperativa de Prueba', abreviacion: null, ...BLANK },
      // codes are NOT normalised: "1005" (no padding) and "001" (padded) coexist live
      { codigo: '1005', descripcion: 'Otra institución', abreviacion: null, ...BLANK },
    ]);
  });

  it('projection edges: a bad DV → rut null; a numeric-string tipo parses; junk tipo → null', async () => {
    const { session } = scripted({
      instituciones: [
        {
          enfinCodigo: '007',
          enfinRutInstitucion: 77777777,
          enfinDvInstitucion: '1',
          enfinTipo: '3',
        },
        { enfinCodigo: '008', enfinTipo: 'otro' },
      ],
    });
    const res = await fetchInstituciones(session, APP);
    expect(res[0]).toMatchObject({ codigo: '007', rut: null, tipo: 3 }); // Mod-11 fails → null
    expect(res[1]).toMatchObject({ codigo: '008', tipo: null });
  });

  it('GETs the cte-api path keyed by the app session userId VERBATIM, with the SPA Referer', async () => {
    const { session } = scripted();
    await fetchInstituciones(session, APP);
    const req = session.lastRequest!;
    expect(req.url).toBe(
      'https://www2.sii.cl/app/cte-api-carpetatributaria/20000042-0/recurso/v2/carpeta-tributaria/instituciones',
    );
    expect(req.options?.method).toBe('GET');
    expect(req.options?.headers?.Referer).toBe(
      'https://www2.sii.cl/carpetatributaria/generarcteregular',
    );
  });

  it('listInstituciones reads the app session BEFORE the cte-api read (else SII answers 401)', async () => {
    const { session, calls } = scripted();
    await listInstituciones(session);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/^text .*\/app\/session\/status\?originalUrl=/);
    expect(calls[1]).toMatch(/^json .*\/20000042-0\/.*\/instituciones$/);
  });

  it('listInstituciones stops at a missing app session: Www2SessionError, no cte-api call', async () => {
    const { session, calls } = scripted({ status: { status: 401, body: '' } });
    await expect(listInstituciones(session)).rejects.toBeInstanceOf(Www2SessionError);
    expect(calls.filter((c) => c.startsWith('json'))).toHaveLength(0);
  });

  it('an empty array is a legitimate "no rows", not an error', async () => {
    const { session } = scripted({ instituciones: [] });
    await expect(fetchInstituciones(session, APP)).resolves.toEqual([]);
  });

  it('a non-array body is "scraper roto" (CarpetaError)', async () => {
    const { session } = scripted({
      instituciones: { respEstado: { codRespuesta: 0 }, data: LIST },
    });
    await expect(fetchInstituciones(session, APP)).rejects.toThrow(/Scraper roto/);
    await expect(fetchInstituciones(session, APP)).rejects.toBeInstanceOf(CarpetaError);
  });

  it('a row without enfinCodigo is "scraper roto" — never a half-usable list', async () => {
    const { session } = scripted({ instituciones: [{ enfinDescripcion: 'sin código' }] });
    await expect(fetchInstituciones(session, APP)).rejects.toThrow(/enfinCodigo/);
  });

  it('lets a dead-session NotAuthenticated through verbatim; wraps other seam failures', async () => {
    const dead = new FakePortalSession({
      requestJson: () => {
        throw new SessionExpiredError('Sesión expirada.');
      },
    });
    await expect(fetchInstituciones(dead, APP)).rejects.toBeInstanceOf(SessionExpiredError);

    const odd = new FakePortalSession({
      requestJson: () => {
        throw new UnexpectedResponseError('GET …/instituciones → 401 (sin content-type): ""');
      },
    });
    const err = await fetchInstituciones(odd, APP).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CarpetaError);
    expect((err as Error).message).toContain('401'); // the seam's verbatim detail survives
  });
});

describe('resolveInstitucion — the --institucion gate for `carpeta regular` (#109)', () => {
  const LIVE = [
    { codigo: '001', descripcion: 'Banco Sintético Uno', abreviacion: 'BSU', ...BLANK },
    { codigo: '042', descripcion: 'Cooperativa de Prueba', abreviacion: null, ...BLANK },
  ];

  it('returns the matching live row (whitespace-tolerant, exact code otherwise)', () => {
    expect(resolveInstitucion(' 042 ', LIVE)).toEqual(LIVE[1]);
    expect(resolveInstitucion('001', LIVE)).toEqual(LIVE[0]);
  });

  it('rejects a code not in the live list, naming the valid codes', () => {
    expect(() => resolveInstitucion('1011', LIVE)).toThrow(CarpetaError);
    expect(() => resolveInstitucion('1011', LIVE)).toThrow(/"1011".*001 \(BSU\), 042/);
    // no zero-padding or numeric coercion: "1" is not "001"
    expect(() => resolveInstitucion('1', LIVE)).toThrow(CarpetaError);
  });

  it('says so when SII served no institutions at all', () => {
    expect(() => resolveInstitucion('001', [])).toThrow(/no devolvió instituciones/);
  });
});
