// Shared MCP tool helpers. Each domain module owns a `tools/<mod>.ts` exporting a
// `register<Mod>Tools(server, runtime)`; they all reuse `toolText` so SII's Spanish
// error messages surface verbatim and the registration stays uniform across modules.

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Run a task and wrap its text as a tool result; domain errors come back as an
 *  error result carrying SII's Spanish message verbatim (CONVENTIONS). */
export async function toolText(fn: () => Promise<string>): Promise<{
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}> {
  try {
    return { content: [{ type: 'text', text: await fn() }] };
  } catch (e) {
    return { content: [{ type: 'text', text: messageOf(e) }], isError: true };
  }
}
