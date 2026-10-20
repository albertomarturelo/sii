import { afterEach, describe, it, expect } from 'vitest';
import {
  Gwt7Codec,
  type Gwt7Call,
  type Gwt7Node,
  type Gwt7Value,
  buildPeticionesRequest,
  clearGwtPermutations,
  decodeGwtResponse,
  isGwt7PolicyError,
  isNode,
  isPolicyError,
  parseGwtPermutation,
  parseJsLiteral,
  postGwt7,
} from './gwt.js';
import { F29Error, PeticionesError } from '../errors/index.js';
import { FakePortalSession } from '../adapters/fake/index.js';
import { encodeOk } from './__fixtures__/gwt-encode.js';

describe('gwt codec', () => {
  it('builds the peticionesUsuario request with the observed invocation layout', () => {
    const body = buildPeticionesRequest('https://host/mod/', 'HASH123', 20000042, 'TOK');
    expect(body).toBe(
      '5|0|7|https://host/mod/|HASH123|' +
        'cl.sii.sdi.difsj.sispadinternet.web.client.service.aplicacion.peticion.ServicePeticion|' +
        'peticionesUsuario|java.lang.Integer/3438268394|java.lang.String/2004016611|TOK|' +
        '1|2|3|4|2|5|6|5|20000042|7|',
    );
  });

  it('decodes a //OK object graph and consumes it exactly', () => {
    const root = decodeGwtResponse(encodeOk([{ numero: 1, materiaGlosa: null, estados: [] }]));
    expect(isNode(root)).toBe(true);
    expect(isNode(root) ? root.items?.length : 0).toBe(1);
  });

  it('fails loud on an unknown wire type (recompiled with changed types → scraper roto)', () => {
    const wire = '//OK' + JSON.stringify([1, ['cl.sii.sdi.difsj.sispad.to.Nueva/9'], 0, 5]);
    expect(() => decodeGwtResponse(wire)).toThrow(PeticionesError);
    expect(() => decodeGwtResponse(wire)).toThrow(/scraper roto/);
  });

  it('rejects leftover tokens (a shape drift) rather than returning partial data', () => {
    // one extra trailing token beyond a null root
    const wire = '//OK' + JSON.stringify([0, 0, [], 0, 5]);
    expect(() => decodeGwtResponse(wire)).toThrow(/scraper roto/);
  });

  it('isPolicyError flags an incompatible-policy //EX (the self-heal trigger)', () => {
    expect(isPolicyError(new PeticionesError('IncompatibleRemoteServiceException'))).toBe(true);
    expect(isPolicyError(new PeticionesError('El contribuyente no tiene acceso.'))).toBe(false);
    expect(isPolicyError(new Error('IncompatibleRemoteService'))).toBe(false);
  });
});

// ── Protocol 7 (rfiInternet) — SYNTHETIC layouts, signatures and values only. No captured
// payload is committed: the real ones carry the empresa's data (#159).

const LAYOUT: Readonly<Record<string, string>> = {
  'java.lang.Integer': 'i',
  'java.lang.Boolean': 'z',
  'java.lang.Short': 'h',
  'java.lang.Double': 'd',
  'java.lang.Long': 'l',
  'java.lang.String': 's',
  'java.math.BigDecimal': 's',
  'java.util.Date': 'l',
  'java.sql.Timestamp': 'li',
  'java.util.ArrayList': 'L',
  'java.util.HashMap': 'M',
  // every op in one class: string, int, boolean, short, double, long, object ×2, list, map
  'test.Demo': 'sizhdlooLM',
  'test.Ref': 'so',
};
const SIGS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.keys(LAYOUT).map((c, k) => [c, `${c}/${1000 + k}`])),
  '[Ljava.lang.String;': '[Ljava.lang.String;/2001',
  '[I': '[I/2002',
  '[Ltest.Ref;': '[Ltest.Ref;/2003',
};
const codec = new Gwt7Codec({ write: LAYOUT, read: LAYOUT }, SIGS, (m) => new F29Error(m));
const node = (cls: string, ...values: Gwt7Node['values']): Gwt7Node => ({ cls, values });

// A graph that exercises every listed type, a back-reference and a cycle.
function demoGraph(): Gwt7Node {
  const shared = node('java.math.BigDecimal', '1234.50');
  const ref = node('test.Ref', 'loop', null);
  ref.values[1] = ref; // a cycle: the object references itself
  return node(
    'test.Demo',
    'tilde ñ, pipe | and back\\slash, nul \u0000, combining ́', // escaped on the wire
    40,
    1,
    7,
    0.5,
    'Z9s$_A', // a long travels as GWT's base64 token, verbatim
    node('java.sql.Timestamp', 'AY2X$a', 123000000),
    ref,
    [
      shared,
      shared, // the same object twice → a back-reference
      node('java.util.Date', 'AY2Xa'),
      node('java.lang.Integer', 41),
      node('java.lang.Boolean', 0),
      null,
      node('[Ljava.lang.String;', 'a', null, 'c'),
      node('[I', 1, 2, 3),
      node('[Ltest.Ref;', ref),
    ],
    [
      [node('java.lang.String', 'k1'), node('java.lang.Long', 'B')],
      [node('java.lang.String', 'k2'), null],
    ],
  );
}
const demoCall = (): Gwt7Call => ({
  moduleBase: 'https://example.invalid/mod/',
  policy: '0123456789ABCDEF0123456789ABCDEF',
  service: 'test.Facade',
  method: 'enviar',
  params: [
    { type: 'java.lang.Integer', value: node('java.lang.Integer', 40) },
    { type: 'test.Demo', value: demoGraph() },
    { type: 'java.lang.String', value: 'PARAM_X' },
    { type: 'I', value: 7 },
    { type: 'test.Ref', value: null },
  ],
});

describe('gwt protocol 7 codec', () => {
  it('encodes the observed request framing: header strings, param types, a String param', () => {
    const body = codec.encodeRequest({
      moduleBase: 'https://example.invalid/mod/',
      policy: 'HASH',
      service: 'test.Facade',
      method: 'consultar',
      params: [{ type: 'java.lang.String', value: 'PARAM_X' }],
    });
    // String table first (1-based, first use), then moduleBase/policy/service/method refs,
    // the param count, the param type ref and the bare string ref.
    expect(body).toBe(
      '7|0|6|https://example.invalid/mod/|HASH|test.Facade|consultar|java.lang.String/1005|' +
        'PARAM_X|1|2|3|4|1|5|6|',
    );
  });

  it('round-trips a graph: decode(encode(graph)) deep-equals it, identity included', () => {
    const call = demoCall();
    const back = codec.decodeRequest(codec.encodeRequest(call));
    expect(back).toEqual(call);
    const demo = back.params[1]!.value as Gwt7Node;
    const list = demo.values[8] as Gwt7Value[];
    expect(list[0]).toBe(list[1]); // the back-reference resolves to the same object
    const ref = demo.values[7] as Gwt7Node;
    expect(ref.values[1]).toBe(ref); // and the cycle closes
  });

  it('round-trips bytes: encode(decode(bytes)) === bytes', () => {
    const bytes = codec.encodeRequest(demoCall());
    expect(bytes).toContain('pipe \\! and back\\\\slash, nul \\0, combining \\u0301');
    expect(codec.encodeRequest(codec.decodeRequest(bytes))).toBe(bytes);
  });

  it('fails loud on a class missing from the layouts or from the permutation', () => {
    const call = (value: Gwt7Node): Gwt7Call => ({
      ...demoCall(),
      params: [{ type: 'test.Ref', value }],
    });
    expect(() => codec.encodeRequest(call(node('test.Unknown')))).toThrow(
      /scraper roto.*sin firma en la permutación: test\.Unknown/,
    );
    const noLayout = new Gwt7Codec(
      { write: {}, read: {} },
      { ...SIGS, 'test.Bare': 'test.Bare/1' },
      (m) => new F29Error(m),
    );
    expect(() => noLayout.encodeRequest(call(node('test.Bare')))).toThrow(
      /tipo sin esquema: test\.Bare/,
    );
    expect(() => codec.encodeRequest(call(node('test.Ref', 'only one value')))).toThrow(
      /test\.Ref tiene 1 valores; su esquema, 2/,
    );
    expect(() => codec.encodeRequest(call(node('test.Ref', 5, null)))).toThrow(F29Error);
  });

  it('decodes a response with the "…"+"…" and […].concat(…) splits GWT uses', () => {
    // Root test.Ref('abcdef', Integer(41)), read backwards: 1 (its signature), 3 (the string),
    // 2 (the Integer's signature), 41. GWT splits the outer array with .concat and long
    // strings with "+".
    const text =
      `//OK[41,2].concat([3,1,["test.Ref/1"+"012",'java.lang.Integer/1000',` + `"abc"+'def'],0,7])`;
    expect(codec.decodeResponse(text)).toEqual(
      node('test.Ref', 'abcdef', node('java.lang.Integer', 41)),
    );
  });

  it('reads a String[] element as a bare string, not a String object', () => {
    // Observed in SdiAAInfoUsuario's response (2026-10-19): 1 (the array's signature), 2 (its
    // length), then two string-table refs.
    expect(codec.decodeResponse('//OK[3,2,2,1,["[Ljava.lang.String;/2001","a","b"],0,7]')).toEqual(
      node('[Ljava.lang.String;', 'a', 'b'),
    );
  });

  it('decodes String, primitive and void returns, which GWT writes bare', () => {
    expect(codec.decodeResponse('//OK[1,["valor"],0,7]', 'java.lang.String')).toBe('valor');
    expect(codec.decodeResponse('//OK[1,[],0,7]', 'Z')).toBe(1);
    expect(codec.decodeResponse('//OK[[],0,7]', 'V')).toBeNull();
  });

  it('raises a //EX message verbatim, and a changed shape as "scraper roto"', () => {
    const ex =
      '//EX[2,1,["cl.sii.sdi.dim.rfi.web.shared.exception.RfiException/1",' +
      '"Período no habilitado"],0,7]';
    expect(() => codec.decodeResponse(ex)).toThrow(
      'SII rechazó la operación: Período no habilitado',
    );
    expect(() => codec.decodeResponse('//OK[1,["test.Nope/9"],0,7]')).toThrow(
      /tipo sin esquema: test\.Nope/,
    );
    expect(() => codec.decodeResponse('<html>')).toThrow(/no es \/\/OK/);
    expect(() => codec.decodeResponse('//OK[1,2,["test.Ref/1"],0,7]')).toThrow(/scraper roto/);
  });

  const longCodec = new Gwt7Codec(
    { write: { 'test.L': 'l' }, read: { 'test.L': 'l' } },
    { 'test.L': 'test.L/1' },
    (m) => new F29Error(m),
  );
  const bad = (value: Gwt7Value, type = 'java.util.ArrayList'): Gwt7Call => ({
    ...demoCall(),
    params: [{ type, value }],
  });
  it.each<[string, () => unknown, RegExp]>([
    [
      'a protocol-5 request',
      () => codec.decodeRequest('5|0|1|x|1|1|1|1|0|'),
      /protocolo 5, se esperaba 7/,
    ],
    [
      'a request missing its header strings',
      () => codec.decodeRequest('7|0|0|0|0|0|0|0|'),
      /cabecera incompleta/,
    ],
    [
      "a response whose long field's token is a number",
      () => longCodec.decodeResponse('//OK[5,1,["test.L/1"],0,7]'),
      /se esperaba un long/,
    ],
    [
      "a node whose 'L' field is not an array",
      () => codec.encodeRequest(bad(node('java.util.ArrayList', 'not a list'))),
      /debe ser una lista/,
    ],
    [
      'a map entry that is not a pair',
      () =>
        codec.encodeRequest(
          bad(node('java.util.HashMap', [[node('java.lang.String', 'k')]]), 'java.util.HashMap'),
        ),
      /debe ser \[clave, valor\]/,
    ],
    [
      'a request whose double token is not a number',
      () =>
        codec.decodeRequest(
          '7|0|6|https://example.invalid/mod/|H|test.Facade|m|java.lang.Double/1003|x|' +
            '1|2|3|4|1|5|5|abc|',
        ),
      /se esperaba un double/,
    ],
  ])('fails loud on %s', (_name, run, detail) => {
    expect(run).toThrow(F29Error);
    expect(run).toThrow(/scraper roto/);
    expect(run).toThrow(detail);
  });

  it('parses JS literals with \\x / \\u escapes', () => {
    expect(parseJsLiteral(`["a\\x41\\u00f1", -1.5e2, []]`)).toEqual(['aAñ', -150, []]);
    expect(() => parseJsLiteral('[1,2')).toThrow();
  });
});

describe('gwt protocol 7 permutation + self-heal', () => {
  afterEach(() => clearGwtPermutations());
  const PERM = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const H1 = '11111111111111111111111111111111';
  const H2 = '22222222222222222222222222222222';
  const js = (hash: string): string =>
    `function PHc(){WDc();Yc.call(this,nge(),'formularioFacade','${hash}',VDc)}` +
    `ab='java.lang.Integer/3438268394';cd='[Ljava.lang.String;/2600011424';`;
  const ref = {
    moduleBase: 'https://example.invalid/mod/',
    nocache: 'mod.nocache.js',
    entryPoint: 'formularioFacade',
  };
  const fail = (m: string): Error => new F29Error(m);

  it('reads the policy and the signatures from the permutation JS', () => {
    expect(parseGwtPermutation(PERM, js(H1))).toEqual({
      strongName: PERM,
      policies: { formularioFacade: H1 },
      sigs: {
        'java.lang.Integer': 'java.lang.Integer/3438268394',
        '[Ljava.lang.String;': '[Ljava.lang.String;/2600011424',
      },
    });
  });

  it('caches the permutation, and re-reads it once on a policy refusal', async () => {
    let deployed = H1; // the policy SII serves and accepts
    const gets: string[] = [];
    const posts: string[] = [];
    const policyEx =
      '//EX[2,1,["com.google.gwt.user.client.rpc.IncompatibleRemoteServiceException/3936916533",' +
      '"This application is out of date"],0,7]';
    const session = new FakePortalSession({
      requestText: (url, opts) => {
        if (opts?.method === 'GET') {
          gets.push(url);
          return url.endsWith('nocache.js') ? `x='${PERM}'` : js(deployed);
        }
        posts.push(opts?.body ?? '');
        return opts?.body?.includes(deployed) ? '//OK[1,["ok"],0,7]' : policyEx;
      },
    });
    const build = (p: { policies: Readonly<Record<string, string>> }): string =>
      `body with ${p.policies['formularioFacade']}`;
    const OK = '//OK[1,["ok"],0,7]';

    expect(await postGwt7(session, ref, build, fail)).toBe(OK);
    expect(gets).toEqual([
      `${ref.moduleBase}mod.nocache.js`,
      `${ref.moduleBase}${PERM}.cache.html`,
    ]);
    expect(session.lastTextRequest?.options?.headers?.['X-GWT-Permutation']).toBe(PERM);
    expect(await postGwt7(session, ref, build, fail)).toBe(OK);
    expect(gets).toHaveLength(2); // cached

    deployed = H2; // SII redeploys: the cached H1 is refused, then re-read once
    expect(await postGwt7(session, ref, build, fail)).toBe(OK);
    expect(gets).toHaveLength(4);
    expect(posts.slice(-2).map((b) => b.includes(H2))).toEqual([false, true]);
    expect(isGwt7PolicyError(policyEx)).toBe(true);

    deployed = H1; // heal:false hands the refusal back untouched, without re-reading
    expect(await postGwt7(session, ref, build, fail, { heal: false })).toBe(policyEx);
    expect(gets).toHaveLength(4);
  });

  it('fails loud when SII still refuses the policy after the re-read', async () => {
    const policyEx =
      '//EX[2,1,["com.google.gwt.user.client.rpc.IncompatibleRemoteServiceException/3936916533",' +
      '"This application is out of date"],0,7]';
    let posts = 0;
    // The served permutation (H1) never matches what SII accepts: the re-read cannot help.
    const session = new FakePortalSession({
      requestText: (url, opts) => {
        if (opts?.method === 'GET') return url.endsWith('nocache.js') ? `x='${PERM}'` : js(H1);
        posts++;
        return policyEx;
      },
    });
    await expect(postGwt7(session, ref, () => 'body', fail)).rejects.toThrow(
      /política de serialización de formularioFacade tras releer.*scraper roto/,
    );
    expect(posts).toBe(2); // the original send + exactly one resend, never more
  });

  it('fails loud when no permutation declares the entry point', async () => {
    const session = new FakePortalSession({
      requestText: (url) => (url.endsWith('nocache.js') ? `x='${PERM}'` : 'nothing here'),
    });
    await expect(postGwt7(session, ref, () => '', fail)).rejects.toThrow(
      /política de serialización de formularioFacade.*scraper roto/,
    );
  });
});
