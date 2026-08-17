# Task 7 Report

## Status

Implemented policy-first image orchestration, guaranteed temporary-object cleanup, and an additive visual-claim validator in the Task 7 commit (`feat: gate image-aware reply drafts`).

## TDD Evidence

The orchestration and processor tests were written first. The initial focused run failed because the attachment processor and image-aware engine path did not exist. Prompt and image-validator tests also failed before their optional visual section and separate validator were added.

Repository integration coverage was verified with a dedicated disposable PostgreSQL database. To prove the persistence test was meaningful, the production repository patch was temporarily reversed while the test remained present; the run failed with `repository.createImageAnalysisAttempt is not a function`. Restoring the implementation made all 10 integration tests pass.

Independent review produced three valid regressions, each observed failing before its fix:

- provider usage/cost could be lost if the first terminal persistence write failed;
- an analyzed result could be reused after temporary-object deletion failed;
- definitive claims such as `We can fully restore this photo` and `This photo is ready to print` passed the additive validator.

The processor now preserves returned usage on persistence failure, previous analysis is reusable only after every related object is marked deleted, and the visual validator blocks the additional definitive claim forms.

## Implementation

- Extended internal draft generation with optional ephemeral attachment sources while leaving public generate/regenerate request bodies unchanged and empty.
- Kept the existing policy gate first. High risk, unresolved, realtime-required, and image-only inputs stop before both image and text providers.
- Added attachment processing through the existing source-reader, private-store, image-provider, and repository interfaces.
- Validated selected attachment IDs, source metadata, byte limits, MIME type, and SHA-256 before analysis.
- Reserved image cost against the existing daily and total budget rows before the single provider call, then released the reservation and persisted actual usage/cost on every terminal provider path.
- Persisted exact image-analysis input membership and safe terminal states. Cross-conversation attachment membership is rejected.
- Deleted every temporary object from `finally`; cleanup failures retain the deletion guard, mark the attachment failed, and prevent analysis reuse.
- Reused only validated, assessed, fully cleaned image summaries on manual regeneration without downloading or analyzing again.
- Added the optional `VISUAL ASSESSMENT` prompt section using only the validated safe summary. No image bytes or source URLs enter the text prompt.
- Added a separate image draft validator used only when visual context exists. The existing `output-validator.ts` remains byte-for-byte unchanged.
- Preserved the frozen text-only prompt and provider path.
- Wired the processor conditionally in the existing runtime without changing production configuration, callbacks, retry behavior, or send behavior.

## Security and Scope Review

- Policy-blocked and image-only cases make zero image-provider and text-provider calls.
- Invalid image input, budget denial, provider failure, persistence failure, and cleanup failure make zero text-provider calls.
- The image provider is called at most once; no automatic retry was added.
- Temporary object deletion executes in `finally` for every path after a save.
- Public generate/regenerate handlers, Meta callback code, customer-service configuration, sending code, and production configuration are unchanged.
- `output-validator.ts` has the same pre/post SHA-256: `3e95c2af99e18b91cbaa8351df5c3907aa64066fbf21ee795c262a5852581a76`.
- Repository/type changes are limited to the image-attempt persistence required by Task 7; no parallel storage or provider abstraction was introduced.

## Verification

- Required orchestration command: 5 files passed, 35 tests passed.
- Attachment processor and security/route regression command: 5 files passed, 16 tests passed.
- PostgreSQL repository integration: 1 file passed, 10 tests passed.
- `npm run typecheck`: passed.
- Targeted ESLint across all 13 changed TypeScript files: passed with zero warnings or errors.
- `git diff --check`: passed.
- Scoped diff audit confirmed zero changes to the existing output validator, public request handlers, customer-service config, and Meta webhook handler.

## Independent Review

Two earlier persistence/cleanup findings and the additive-validator coverage finding were fixed with failing regressions first. Two webhook/source-recovery suggestions were not applied because Task 7 explicitly keeps source context ephemeral and forbids callback changes; Task 8 owns the DB-first Meta handoff that closes over normalized attachment references.

## Concerns

No Task 7 blocker remains. The production Meta webhook will not supply ephemeral attachment sources until Task 8 is implemented, by design. No live OpenAI request was made; provider behavior remains covered at the existing controlled boundary.
