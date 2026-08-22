# Task 12 Fix Round 1 Implementer Report

Base commit: `3f9b401`

## Fixed

- Normal submission now always creates a payload from the visible trimmed draft and a new client message key.
- The only key-reuse path is the explicit `Retry message` control. It is shown only while the visible draft exactly matches the pending failed payload; the normal send control is disabled in that state and Enter gives an accessible retry instruction.
- Editing a failed draft hides the stale retry control, enables normal send, and sends the exact edited text. A successful request clears that accepted visible draft only.
- Customer chat is now excluded from `/privacy-policy` and `/pay` plus descendants, while SiteChrome continues to render the storefront header and footer for those public pages.
- Shift+Enter regression now asserts the event is not default-prevented and the textarea contains the resulting newline before Enter submits it.

## RED Evidence

- `npm exec vitest run src/components/customer-chat/customer-chat.test.tsx src/components/site-chrome.test.tsx` failed with eight expected cases before implementation: edited drafts posted the original message, unchanged pending drafts allowed normal send, and `/privacy-policy` plus `/pay/*` mounted the widget.
- The added stale-retry-after-edit regression then failed because `Retry message` remained visible after the draft changed.

## GREEN Evidence

- Widget and chrome suite: 35 tests passed.
- Focused relevant regression suite: 82 tests in 9 files passed, including `no-auto-send.test.ts` and `security-regression.test.ts`.
- `npm run typecheck`, changed-file ESLint, and `git diff --check HEAD` passed.
- Diff no-send scan found no OpenAI, Facebook/Messenger send, Meta Page token, or Production change in `src`.

## Scope Boundary

No API, database, Facebook, no-send, OpenAI, or Production architecture changed. No DB suite and no Next development server were run. `AGENTS.md` remains an unrelated unstaged generated modification and is excluded from this commit.
