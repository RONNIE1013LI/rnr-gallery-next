# Task 8 Report

## Status

Implemented the DB-first Meta webhook attachment handoff. A newly created Messenger message persists only HMAC-hashed identifiers and safe attachment metadata before a deferred image-aware draft task receives the normalized in-memory attachment references.

## TDD Evidence

The new image-only webhook test was written before the production handoff. The required focused command failed with one assertion: the deferred `generateDraft` call received only `internal-1`, not its normalized attachment-source context. The same command passed with 9 tests after the minimal bridge was added.

The webhook tests also prove that invalid signatures and wrong Page IDs do not construct the Facebook adapter, image metadata persistence precedes `scheduleAfter`, echoes do not persist or schedule, and duplicate and pilot-complete results do not schedule. The deferred-failure regression observes an HTTP 200 after ingest, then runs a rejected deferred task and confirms it resolves without changing that response.

## Implementation

- Kept signature verification and Page validation before Facebook adapter construction and normalization.
- Continued hashing external conversation, message, and attachment identities before repository ingest.
- Continued persisting only attachment kind, ordinal, MIME hint, and external attachment-key hash. The webhook repository input and response body contain no remote source URL.
- Captured `message.attachments` in the created-only `after()` callback and passed it as the existing Task 7 internal attachment-source context to the engine.
- Updated the route bridge to forward that internal context to `engine.generateDraft` while retaining the existing `webhook_after` trigger.
- Kept deferred errors swallowed after persistence so they cannot turn the committed Meta webhook response into a failure.

## Scope And Privacy Review

- No Production callback configuration, customer-service configuration, send behavior, or public generate/regenerate request body changed.
- No repository interface, database schema, logging path, or response body receives attachment source URLs.
- Attachment references exist only as normalized in-memory data captured for the deferred task of a newly created message.
- Duplicate, echo, disabled, wrong-page, and non-created ingest paths do not schedule deferred image work.

## Verification

- `npm run test:run -- src/server/customer-service/meta/webhook-handler.test.ts src/app/api/meta/webhook/route.test.ts`: 2 files passed, 9 tests passed.
- `npm run typecheck`: passed.
- `npx eslint src/server/customer-service/meta/webhook-handler.ts src/server/customer-service/meta/webhook-handler.test.ts src/app/api/meta/webhook/route-handler.ts src/app/api/meta/webhook/route.test.ts`: passed with zero warnings or errors.
- `git diff --check`: passed.

## Concerns

No live Meta callback or image-provider request was made. Deferred execution depends on the deployment platform honoring Next.js `after()` completion semantics; the existing route remains Node runtime with a 30-second maximum duration.
