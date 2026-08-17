# Task 3 Report: Inspect All Attachments Before the Image Source Cap

## Root Cause

`normalizedAttachments` stopped once five normalized entries had been collected. A sixth valid image, file, malformed record, or invalid image URL was never represented, so webhook intake could build an encrypted pending job from the first five sources and schedule the image runner.

## RED

```bash
npm run test:run -- src/server/customer-service/adapters/facebook.test.ts src/server/customer-service/meta/webhook-handler.test.ts
```

Result: 2 files, 5 intended failures. Six valid images and each five-valid-plus-trailing-invalid case produced only five normalized attachments. The mixed webhook case persisted a pending encrypted job instead of a source-free terminal job.

## GREEN

The adapter now inspects every raw attachment. It stores at most five valid remote image sources. Every later valid image becomes `too_many_attachments`; files, malformed records, and invalid image URLs retain their existing safe failure codes. These markers have `sourceRef: null`, so no trailing raw URL is retained.

Webhook intake treats any marker as unsupported, persists a `human_review_required` job with `sourceCiphertext: null` and `sourceExpiresAt: null`, and schedules neither the image runner nor text generation. Therefore the fail-closed path has no decrypt, download, or provider call.

## Changed Files

- `src/server/customer-service/adapters/facebook.ts`
- `src/server/customer-service/attachments/types.ts`
- `src/server/customer-service/repositories/customer-service-repository.ts`
- `src/server/customer-service/adapters/facebook.test.ts`
- `src/server/customer-service/meta/webhook-handler.test.ts`

## Tests

```bash
npm run test:run -- src/server/customer-service/adapters/facebook.test.ts src/server/customer-service/meta/webhook-handler.test.ts
```

Passed: 2 files, 21 tests.

```bash
npm run typecheck
```

Passed.

```bash
npm run test:run -- src/server/customer-service/adapters/facebook.test.ts src/server/customer-service/meta/webhook-handler.test.ts src/server/customer-service/image-job-runner.test.ts src/server/customer-service/policy-gate.test.ts src/server/customer-service/policy-regression.test.ts src/server/customer-service/security-regression.test.ts src/server/customer-service/no-auto-send.test.ts src/server/customer-service/serverless-compatibility.test.ts
```

Passed: 8 files, 54 tests.

```bash
git diff --check
```

Passed before commit.

## Commit

- `3dc9c1c fix: inspect Facebook attachments before image cap`

## Concerns

No deployment, Production access, schema migration, source decrypt, attachment download, or provider call was performed. The task intentionally retains safe metadata for every raw attachment so an oversized or malformed trailing entry cannot be silently discarded.
