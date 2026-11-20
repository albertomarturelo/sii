// The issue guide (ADR-037) is prose a model reads, so nothing compiles it. This keeps its
// error-kind table equal to the typed map: a kind added to the core fails the typecheck in
// issue-kinds.ts, and a guide row missing, extra or reclassed fails here. No SII.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ISSUE_CLASS } from './issue-kinds.js';

const guide = readFileSync(new URL('../issue-guide.md', import.meta.url), 'utf8');

/** `| \`kind\` | class | why |` rows of the « Error kinds » table. */
const tableRows = (): Record<string, string> =>
  Object.fromEntries(
    [...guide.matchAll(/^\| `([a-z0-9_]+)` \| ([^|]+?) \|/gm)].map((m) => [
      m[1] ?? '',
      (m[2] ?? '').trim(),
    ]),
  );

describe('issue-guide.md', () => {
  it('classifies every error kind exactly as ISSUE_CLASS does', () => {
    expect(tableRows()).toEqual(ISSUE_CLASS);
  });

  it('never tells the model to open the issue itself over the MCP', () => {
    expect(guide).toMatch(/The user publishes/);
    expect(guide).toMatch(/Never put the draft in the URL/);
  });
});
