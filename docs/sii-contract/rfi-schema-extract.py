#!/usr/bin/env python3
# Regenerate packages/core/src/portal/rfi-schema.ts from an rfiInternet GWT permutation
# (ADR-020, ADR-029 amendment). Run after a SII redeploy that changes serializable types
# ("scraper roto" on a request SII cannot read or a response we cannot decode).
#
# Usage:
#   1. Fetch a permutation with an authenticated session (the assets are login-gated):
#        - GET https://www4.sii.cl/rfiInternet/rfi.nocache.js        → 32-hex permutation names
#        - GET https://www4.sii.cl/rfiInternet/<STRONGNAME>.cache.html → the permutation JS
#   2. python3 rfi-schema-extract.py <STRONGNAME>.cache.html > ../../packages/core/src/portal/rfi-schema.ts
#
# It reads the compiled FieldSerializer functions directly (no third-party GWT library —
# ADR-004). The RPC type map `a[sigVar]=[instantiate, deserialize, serialize?]` ties each type
# signature to its functions:
#   - WRITE layout (client → server, what a request carries) = the serialize fn's statements,
#     each a call to one stream writer (or a superclass serializer, inlined in position);
#   - READ layout (server → client, what a response carries) = instantiate + deserialize reads.
# A 2-fn entry has no serializer: the client can only read that type.
#
# Op alphabet, one char per stream op, in order:
#   s=string o=object i=int z=boolean h=short d=double l=long (base64 token)
#   L=collection (size + objects) M=map (size + key/value objects)
#
# The stream writer/reader function names are the permutation's obfuscated identifiers,
# observed in strong-name 543D42AD0EF9E262804F560CE81AF5A6 (2026-10-19). A recompile renames
# them: find the new ones in ClientSerializationStreamWriter/Reader (writeString, writeObject,
# …) and pass them through the WRITERS / READERS environment variables as JSON.
#
# Keyed by CLASS NAME: the per-type CRC in a signature rotates on recompile, the layout does
# not. The CRCs are therefore NOT written here; the core reads them from the live permutation.
import json
import os
import re
import sys

if len(sys.argv) != 2:
    sys.exit('usage: rfi-schema-extract.py <permutation>.cache.html')
t = open(sys.argv[1], encoding='utf-8', errors='replace').read()

WRITERS = {'Swf': 's', 'Qwf': 'o', 'Pwf': 'i', 'Nwf': 'z', 'Rwf': 'h', 'Owf': 'd', 'wvf': 'L', 'lwf': 'M'}
WRITERS.update(json.loads(os.environ.get('WRITERS', '{}')))
LONG_WRAP = os.environ.get('LONG_WRAP', 'exf')  # exf(a,cmf(x)) = writeLong
READERS = [
    (r'^Uwf\(\s*a\s*,\s*Zwf\(\s*a\s*\)\s*\)', 's'),
    (r'^Kwf\(\s*a\s*\)', 'o'),
    (r'^\$wf\(\s*a\s*\)', 'l'),
    (r'^Ywf\(\s*a\s*\)', 'd'),
    (r'^_wf\(\s*a\s*\)', 'h'),
    (r'^Wwf\(\s*a\s*\)', 'z'),
    (r'^Zwf\(\s*a\s*\)', 'i'),
]
READERS = [(re.compile(p), op) for p, op in json.loads(os.environ['READERS'])] if 'READERS' in os.environ \
    else [(re.compile(p), op) for p, op in READERS]
COLL = {'vvf': 'L', 'kwf': 'M'}
COLL.update(json.loads(os.environ.get('COLL', '{}')))

_fn = {}
def fn_body(name):
    if name in _fn:
        return _fn[name]
    m = re.search(r'function ' + re.escape(name) + r'\s*\(([^)]*)\)\s*\{', t)
    if not m:
        _fn[name] = None
        return None
    i, depth = m.end(), 1
    while i < len(t) and depth:
        depth += 1 if t[i] == '{' else -1 if t[i] == '}' else 0
        i += 1
    _fn[name] = ([p.strip() for p in m.group(1).split(',')], t[m.end():i - 1])
    return _fn[name]

def statements(body):
    out, depth, start = [], 0, 0
    for i, ch in enumerate(body):
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        elif ch == ';' and depth == 0:
            out.append(body[start:i])
            start = i + 1
    out.append(body[start:])
    return [s.strip() for s in out if s.strip()]

unknown = []
LOCAL = re.compile(r'^(var\s+[\w$,\s]+|[\w$]+=[\w$.]+)$')
SUPERCALL = re.compile(r'^[A-Za-z_$][\w$]*\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*\)$')
def write_ops(fn, depth=0):
    if depth > 15:
        raise ValueError('depth ' + fn)
    f = fn_body(fn)
    if f is None:
        raise ValueError('missing fn ' + fn)
    ops = []
    for st in statements(f[1]):
        # `var c;c=b.b;Qwf(a,c)` (java.util.Arrays$ArrayList): a local, then the write
        if LOCAL.match(st):
            continue
        m = re.match(r'^([A-Za-z_$][\w$]*)\(', st)
        if not m:
            unknown.append(fn + ': ' + st[:60])
            continue
        callee = m.group(1)
        if callee == LONG_WRAP:
            ops.append('l')
        elif callee in WRITERS:
            ops.append(WRITERS[callee])
        elif fn_body(callee) is not None and SUPERCALL.match(st):
            ops.append(write_ops(callee, depth + 1))  # superclass serializer, in position
        else:
            unknown.append(fn + ': ' + st[:80])
    return ''.join(ops)

def read_ops(fn, depth=0):
    if fn in COLL:
        return COLL[fn]
    f = fn_body(fn)
    if f is None:
        raise ValueError('missing fn ' + fn)
    params, body = f
    a = params[0] if params and params[0] else 'a'
    if a != 'a':
        body = re.sub(r'\b' + re.escape(a) + r'\b', 'a', body)
    ops = []
    for st in statements(body):
        sc = re.match(r'^([A-Za-z_$][\w$]*)\(\s*a\s*,\s*[A-Za-z_$][\w$]*\s*\)$', st)
        if sc and (sc.group(1) in COLL or (fn_body(sc.group(1)) is not None
                                             and not any(r.match(st) for r, _ in READERS))):
            ops.append(COLL.get(sc.group(1)) or read_ops(sc.group(1), depth + 1))
            continue
        i = 0
        while i < len(st):
            rest = st[i:]
            hit = next(((r, op) for r, op in READERS if r.match(rest)), None)
            if hit:
                ops.append(hit[1])
                i += hit[0].match(rest).end()
            else:
                i += 1
    return ''.join(ops)

sigs = {m.group(1): m.group(2) for m in re.finditer(r"([\w$]+)='([a-zA-Z\[][\w.$;\[]*/\d+)'", t)}
write, read, errors = {}, {}, []
for m in re.finditer(r'a\[([\w$]+)\]=\[([^\]]*)\]', t):
    sig = sigs.get(m.group(1))
    if not sig:
        continue
    cls = sig.split('/')[0]
    if cls.startswith('['):
        continue  # arrays: the reader/writer handle them by the signature's "[" prefix
    fns = m.group(2).split(',')
    # A type map entry is [instantiate, deserialize, serialize?]; `undefined` in the first two
    # means the client never reads that type (e.g. XsrfToken). The permutation holds one map
    # per service proxy, so a class can appear several times; the layouts agree.
    if fns[0] not in ('', 'undefined'):
        try:
            read[cls] = read_ops(fns[0]) + read_ops(fns[1])
        except ValueError as e:
            errors.append(f'read {cls}: {e}')
    if len(fns) >= 3 and fns[2]:
        try:
            write[cls] = write_ops(fns[2])
        except ValueError as e:
            errors.append(f'write {cls}: {e}')
# java.lang.String is written by the stream itself (writeObject emits the signature, then the
# string's table index), not by a field serializer: its layout is one string.
if 'java.lang.String' in write:
    write['java.lang.String'] = 's'
mismatch = [c for c in write if c in read and write[c] != read[c]]

strong = re.search(r"strongName\s*=\s*'([0-9A-F]{32})'", t)
# Some GWT serializers are asymmetric in the compiled code itself, e.g. DateRecord writes a
# trailing long its deserializer does not read, and SdiSimpleDateTo's deserializer is empty.
# Each direction keeps its own layout; the difference is reported, not an error.
for c in mismatch:
    sys.stderr.write(f'asymmetric {c}: write={write[c]} read={read[c]}\n')
if errors or unknown:
    for e in errors + unknown[:40]:
        sys.stderr.write(e + '\n')
    sys.exit('extraction incomplete: fix the writer/reader names before regenerating')
sys.stderr.write(f'strong={strong.group(1) if strong else None} write={len(write)} read={len(read)}\n')

def q(v):  # a single-quoted TS string literal, so the output is already Prettier-clean
    return "'" + v.replace('\\', '\\\\').replace("'", "\\'") + "'"

def entry(k, v):  # Prettier's printWidth is 100: a longer entry breaks after the key
    line = f'  {q(k)}: {q(v)},'
    return line if len(line) <= 100 else f'  {q(k)}:\n    {q(v)},'

def table(d):
    return '\n'.join(entry(k, v) for k, v in sorted(d.items()))

print(f"""// GENERATED — do not edit by hand. The GWT-RPC field layouts of the rfiInternet form app
// (the F29 submit transport, ADR-029 amendment). Each key is a Java class name; each value is
// that class's stream ops in order, one char per op: s=string o=object i=int z=boolean h=short
// d=double l=long (base64 token) L=collection M=map. Arrays are handled by the "[" signature
// prefix in the codec, not here.
//
// DERIVED first-hand from the compiled GWT permutation's FieldSerializers (no third-party GWT
// library — ADR-004): strong-name {strong.group(1) if strong else '?'}, module rfiInternet,
// observed 2026-10-19. Keyed by CLASS NAME. The type signatures' CRCs are NOT here: they
// rotate on SII recompile, so the codec reads them from the live permutation (`gwt.ts`).
// Regenerate with docs/sii-contract/rfi-schema-extract.py.

/** The permutation these layouts were derived from. */
export const RFI_SCHEMA_STRONG_NAME = {q(strong.group(1) if strong else '')};

/** Write layouts (serialize fns): what a request may carry, class name → ops. */
export const RFI_WRITE_LAYOUT: Readonly<Record<string, string>> = {{
{table(write)}
}};

/** Read layouts (instantiate + deserialize fns): what a response may carry, class name → ops. */
export const RFI_READ_LAYOUT: Readonly<Record<string, string>> = {{
{table(read)}
}};""")
