// The class each error kind has in `issue-guide.md` (ADR-037): whether a model may recommend an
// issue for it. A Record over `ErrorKind`, like the CLI's EXIT_CODES, so a new kind without a
// class fails the typecheck; `issue-guide.test.ts` keeps the guide's table in agreement.
import type { ErrorKind } from '@albertomarturelo/sii-core';

export type IssueClass = 'not a sii bug' | 'likely bug' | 'suspect';

export const ISSUE_CLASS: Record<ErrorKind, IssueClass> = {
  login_rejected: 'not a sii bug',
  login_blocked: 'not a sii bug',
  login_queued: 'not a sii bug',
  login_failed: 'suspect',
  not_authenticated: 'not a sii bug',
  session_expired: 'suspect',
  www2_session_required: 'not a sii bug',
  rate_limited: 'not a sii bug',
  validation: 'suspect',
  credential_not_found: 'not a sii bug',
  browser_required: 'not a sii bug',
  unexpected_response: 'likely bug',
  sii_error: 'suspect',
  network: 'not a sii bug',
  aborted: 'not a sii bug',
  unexpected: 'likely bug',
};
