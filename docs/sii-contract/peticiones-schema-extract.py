#!/usr/bin/env python3
# Regenerate packages/core/src/portal/gwt-schema.ts from a SISPAD GWT permutation
# (ADR-020). Run after a SII redeploy that changes serializable types ("scraper roto").
#
# Usage:
#   1. Fetch a permutation with an authenticated session (the assets are login-gated):
#        - GET https://www3.sii.cl/sispadinternet/sispadinternet.nocache.js  → 32-hex strong-names
#        - GET https://www3.sii.cl/sispadinternet/<STRONGNAME>.cache.html     → the permutation JS
#   2. python3 peticiones-schema-extract.py <STRONGNAME>.cache.html > ../../packages/core/src/portal/gwt-schema.ts
#
# It reads the compiled `FieldSerializer` deserialize functions directly (no third-party GWT
# library — ADR-004): the RPC method map `p5[sigVar]=[instantiate, deserialize, serialize]`
# ties each type signature to its deserialize fn; that fn's body is a fixed sequence of stream
# reads whose kind is unambiguous in the JS:
#   p1b(a,a.c[--a.b])              -> readString  (s)
#   OIb(b1b(a),N) / b1b(a)         -> readObject  (o)
#   [a.c[--a.b],a.c[--a.b]]        -> readLong    (l)   (value = a+b)
#   a.c[--a.b]  /  !!a.c[--a.b]    -> readInt/Bool (i)
#   FN(a,b)                        -> a superclass deserialize -> inline in position
# Keyed by CLASS NAME (the per-type CRC rotates on recompile; the layout does not).
import re, sys, json

if len(sys.argv) != 2:
    sys.exit('usage: peticiones-schema-extract.py <permutation>.cache.html')
t = open(sys.argv[1], encoding='utf-8', errors='replace').read()

_cache = {}
def fn_info(name):
    if name in _cache:
        return _cache[name]
    m = re.search(r'function ' + re.escape(name) + r'\s*\(([^)]*)\)\s*\{', t)
    if not m:
        _cache[name] = (None, None)
        return _cache[name]
    params = [p.strip() for p in m.group(1).split(',')] if m.group(1).strip() else []
    i = m.end(); depth = 1
    while i < len(t) and depth:
        depth += 1 if t[i] == '{' else -1 if t[i] == '}' else 0
        i += 1
    _cache[name] = (t[m.end():i - 1], params)
    return _cache[name]

BOXED = {
    'java.lang.Integer': 'i', 'java.lang.Short': 'i', 'java.lang.Boolean': 'i',
    'java.lang.Byte': 'i', 'java.lang.Character': 'i', 'java.lang.Long': 'l',
    'java.lang.Double': 'd', 'java.lang.Float': 'd',
    'java.sql.Date': 'l', 'java.sql.Time': 'l', 'java.util.Date': 'l', 'java.sql.Timestamp': 'li',
    'java.lang.String': 's',
    'java.util.ArrayList': 'L', 'java.util.Vector': 'L', 'java.util.HashSet': 'L',
    'java.util.LinkedList': 'L', 'java.util.Stack': 'L',
    'java.util.HashMap': 'M', 'java.util.LinkedHashMap': 'M', 'java.util.TreeMap': 'M',
}

def walk(fn, ops, seen, depth=0):
    if depth > 12 or fn in seen:
        return
    inner, params = fn_info(fn)
    if inner is None:
        raise RuntimeError('missing fn ' + fn)
    a = re.escape(params[0]) if params else 'a'
    inst = re.escape(params[1]) if len(params) > 1 else 'b'
    tok = a + r'\.c\[--' + a + r'\.b\]'
    pats = [
        ('l', re.compile(r'\[' + tok + r',' + tok + r'\]')),
        ('s', re.compile(r'p1b\(' + a + r',' + tok + r'\)')),
        ('o', re.compile(r'OIb\(b1b\(' + a + r'\),\d+\)')),
        ('o', re.compile(r'b1b\(' + a + r'\)')),
        ('i', re.compile(r'!!' + tok)),
        ('i', re.compile(tok)),
    ]
    supercall = re.compile(r'\b([A-Za-z_$][\w$]*)\(' + a + r',' + inst + r'\)')
    i = 0
    while i < len(inner):
        hit = None
        for kind, pat in pats:
            m = pat.match(inner, i)
            if m:
                hit = (kind, m.end()); break
        if hit:
            ops.append(hit[0]); i = hit[1]; continue
        m = supercall.match(inner, i)
        if m:
            walk(m.group(1), ops, seen | {fn}, depth + 1); i = m.end(); continue
        i += 1

sigvars = {m.group(1): m.group(2) for m in
           re.finditer(r"(\w+)='([a-zA-Z][a-zA-Z0-9._]+/[0-9]+|\[L[a-zA-Z0-9._;]+/[0-9]+)'", t)}
reg = {m.group(1): [x.strip() for x in m.group(2).split(',')]
       for m in re.finditer(r'p5\[(\w+)\]=\[([^\]]*)\]', t)}

schema = {}
for var, funcs in reg.items():
    sig = sigvars.get(var)
    if not sig:
        continue
    base = sig.split('/')[0]
    if base.startswith('[L') or base.startswith('[['):
        continue  # object arrays handled by the "[" prefix in the reader
    if base in BOXED:
        schema[base] = BOXED[base]; continue
    ops = []
    walk(funcs[1] if len(funcs) > 1 else funcs[0], ops, set())
    schema[base] = ''.join(ops)

strong = re.search(r"\$strongName\s*=\s*'([0-9A-F]{32})'", t)
header = f'''// GENERATED — do not edit by hand. The GWT-RPC field schema for the SISPAD peticiones
// object graph (ADR-020). Each key is a Java class name; each value encodes that class's
// deserialize field order, one char per field: o=readObject s=readString i=readInt
// (int/boolean/short) l=readLong (2 tokens) d=readDouble L=collection M=map. Object/primitive
// arrays are handled by the "[" sig prefix in the reader, not here.
//
// DERIVED first-hand from the compiled GWT permutation deserializers (no third-party GWT
// library — ADR-004): strong-name {strong.group(1) if strong else '?'}, module sispadinternet
// (GWT 2.0.3). Keyed by CLASS NAME (the per-type CRC in the wire sig rotates on SII recompile;
// the field layout does not). Regenerate with docs/sii-contract/peticiones-schema-extract.py.

/** class name → per-field op string (see header). */
export const GWT_SCHEMA: Readonly<Record<string, string>> = {{
'''
body = ''.join(f'  {json.dumps(k)}: {json.dumps(v)},\n' for k, v in sorted(schema.items()))
sys.stdout.write(header + body + '};\n')
sys.stderr.write(f'resolved {len(schema)} types\n')
