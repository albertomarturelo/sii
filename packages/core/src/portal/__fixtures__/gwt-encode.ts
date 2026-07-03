// Test-only GWT-RPC ENCODER (excluded from dist via __fixtures__). Produces synthetic,
// PII-free `//OK[…]` responses that exercise the real in-house decoder (`../gwt.ts`) — the
// inverse of the reader, driven by the SAME `GWT_SCHEMA`, so a schema change can't silently
// desync the fixtures. Only the curated fields are populated; every other field is the
// op's zero form (null / 0 / long-0 / empty collection).
import { GWT_SCHEMA } from '../gwt-schema.js';

const CN = {
  petArray: '[Lcl.sii.sdi.difsj.sispad.to.PeticionTo;/1',
  pet: 'cl.sii.sdi.difsj.sispad.to.PeticionTo',
  estado: 'cl.sii.sdi.difsj.sispad.to.EstadoPeticionTo',
  materia: 'cl.sii.sdi.difsj.sispad.to.MateriaTo',
  integer: 'java.lang.Integer',
  timestamp: 'java.sql.Timestamp',
  arrayList: 'java.util.ArrayList',
} as const;
const sig = (className: string): string => `${className}/1`;

export interface EstadoSpec {
  readonly glosa: string;
  readonly fechaMs: number | null;
  readonly nota?: string | null;
}
export interface PetSpec {
  readonly numero: number;
  readonly materiaGlosa: string | null;
  readonly estados: readonly EstadoSpec[];
}

// Curated field positions (must mirror portal/peticiones.ts — the observed contract).
const PET_NUMERO = 12;
const PET_MATERIA = 26;
const PET_ESTADOS = 21;
const MATERIA_GLOSA = 10;
const EST_FECHA = 7;
const EST_NOTA = 9;
const EST_GLOSA = 10;

class Writer {
  readonly tokens: number[] = []; // in READ (consume) order; reversed on output
  readonly st: string[] = [];
  private strIdx(s: string): number {
    let i = this.st.indexOf(s);
    if (i < 0) i = this.st.push(s) - 1;
    return i + 1;
  }
  int(n: number): void {
    this.tokens.push(n);
  }
  long(ms: number): void {
    this.tokens.push(ms, 0); // reader sums a+b => ms
  }
  string(s: string | null): void {
    this.tokens.push(s === null ? 0 : this.strIdx(s));
  }
  sigTok(className: string): void {
    this.tokens.push(this.strIdx(sig(className)));
  }
  /** Emit a typed object, populating `values[i]` where given, else the op's zero form. */
  object(className: string, values: Record<number, () => void> = {}): void {
    this.sigTok(className);
    const ops = GWT_SCHEMA[className];
    if (ops === undefined) throw new Error('fixture: no schema for ' + className);
    [...ops].forEach((op, i) => {
      const populate = values[i];
      if (populate) return populate();
      switch (op) {
        case 'o':
        case 's':
          this.tokens.push(0);
          break;
        case 'i':
        case 'd':
          this.int(0);
          break;
        case 'l':
          this.long(0);
          break;
        case 'L':
        case 'M':
          this.int(0);
          break;
      }
    });
  }
  integer(n: number): void {
    this.object(CN.integer, { 0: () => this.int(n) });
  }
  timestamp(ms: number): void {
    // Timestamp ops = "li": long(ms) then int(nanos)
    this.object(CN.timestamp, { 0: () => this.long(ms), 1: () => this.int(0) });
  }
  arrayList(elements: readonly (() => void)[]): void {
    // ArrayList ops = "L": one collection op — size + elements
    this.object(CN.arrayList, {
      0: () => {
        this.int(elements.length);
        for (const el of elements) el();
      },
    });
  }
}

/** Build a synthetic `//OK[…]` peticionesUsuario response for the given petitions. */
export function encodeOk(pets: readonly PetSpec[]): string {
  const w = new Writer();
  // top-level object array: sig token + length + elements
  w.sigTok(CN.petArray.replace(/\/1$/, '')); // sig() re-adds /1
  w.int(pets.length);
  for (const p of pets) {
    w.object(CN.pet, {
      [PET_NUMERO]: () => w.integer(p.numero),
      [PET_MATERIA]: () =>
        w.object(CN.materia, { [MATERIA_GLOSA]: () => w.string(p.materiaGlosa) }),
      [PET_ESTADOS]: () =>
        w.arrayList(
          p.estados.map(
            (e) => () =>
              w.object(CN.estado, {
                [EST_FECHA]: () => (e.fechaMs === null ? w.tokens.push(0) : w.timestamp(e.fechaMs)),
                [EST_NOTA]: () => w.string(e.nota ?? null),
                [EST_GLOSA]: () => w.string(e.glosa),
              }),
          ),
        ),
    });
  }
  const payload = [...w.tokens].reverse();
  return '//OK' + JSON.stringify([...payload, w.st, 0, 5]);
}

/** A synthetic `//EX[…]` business error carrying `message` verbatim in the string table. */
export function encodeEx(message: string): string {
  return '//EX' + JSON.stringify([1, [message], 0, 5]);
}
