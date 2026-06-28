// The active operating RUT must ALWAYS be visible (ADR-005): a contador must never
// guess which RUT a command acts under. Printed to STDERR before every command so
// STDOUT stays a clean machine-readable result. No-op when there's no session yet
// (e.g. before `auth login`).
import { Rut, operatingStatus, type Runtime } from '@sii/core';
import { err } from './io.js';

export async function printOperatingHeader(runtime: Runtime): Promise<void> {
  const ctx = await operatingStatus(runtime);
  if (!ctx) return;
  const rut = Rut.parse(ctx.operatingRut).formatted;
  // razón social is the user's own represented empresa shown on their own terminal
  // (never audited, never sent to an LLM — that boundary is enforced in @sii/core).
  const who = ctx.isSelf ? 'tú mismo' : (ctx.razonSocial ?? 'empresa representada');
  err(`operating as: ${rut} (${who})`);
}
