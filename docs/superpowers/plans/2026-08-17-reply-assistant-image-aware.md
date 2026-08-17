# Phase 3.4 Image-Aware Customer Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add privacy-preserving image understanding to the existing human-review Reply Assistant without weakening its text policy gate, output validator, customer isolation, or no-send boundary.

**Architecture:** Keep the existing channel-independent Customer Service Engine and add an optional attachment stage after the text policy gate. Facebook supplies short-lived attachment references through its adapter; the server validates and stores eligible bytes privately, obtains a strict structured vision assessment, retrieves the existing confirmed knowledge bundle, and then uses the unchanged text drafting path and mandatory output validator. Website Chat receives only the shared attachment interface in this phase.

**Tech Stack:** Next.js 16 Route Handlers and `after()`, TypeScript 5, PostgreSQL, Drizzle ORM, Zod 4, OpenAI Responses API, private Vercel Blob, Sharp metadata inspection, Vitest, React 19.

## Global Constraints

- Preserve the frozen Phase 3.3 baseline: direct approval 78.33%, assisted acceptance 100%, required-point coverage 97.33%, policy bypass 0, policy violations 0.
- Do not enable automatic sending or add `META_PAGE_ACCESS_TOKEN`.
- Do not modify Production, the Production Meta callback, Production database, Production feature flag, or Website Chat.
- HIGH RISK, UNRESOLVED and REALTIME_REQUIRED must be blocked before image download and before every OpenAI call.
- The existing output validator remains unchanged and mandatory; an additive image-only validator handles unsupported visual guarantees.
- Do not edit customer images, generate designs, identify people, infer sensitive traits, quote prices, promise delivery, certify print suitability, or guarantee restoration.
- Attachments and text must be selected server-side from one conversation only; never accept customer or attachment IDs from the browser as cross-conversation context.
- Accept at most five JPEG, PNG or WebP images, four MB per image, twelve MB total, twenty megapixels per image and 8192 pixels on either side.
- Reject SVG, GIF, HEIC, HEIF, TIFF, BMP, PDF, mismatched signatures, redirects outside the allowlist and oversized responses before model invocation.
- Raw Facebook attachment URLs, image bytes, sender IDs, conversation IDs, secrets and unnecessary customer identifiers must not enter logs, feedback, model-usage rows or browser DTOs.
- Private image bytes must be deleted on every terminal path and by a 24-hour expiry cleanup guard.
- No automatic provider retry; failures must end in human review.
- All database changes are additive only.
- `REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED` defaults to `false`.

---

## File Map

### Create

- `src/server/customer-service/attachments/types.ts` — channel-independent attachment and analysis types.
- `src/server/customer-service/attachments/limits.ts` — immutable file, batch, timeout and retention limits.
- `src/server/customer-service/attachments/image-validation.ts` — MIME signature and Sharp metadata validation.
- `src/server/customer-service/attachments/facebook-source-reader.ts` — bounded HTTPS download with redirect and host controls.
- `src/server/customer-service/attachments/private-attachment-store.ts` — private Blob storage under the customer-service prefix.
- `src/server/customer-service/attachments/attachment-processor.ts` — validate, persist, analyse and delete lifecycle.
- `src/server/customer-service/attachments/*.test.ts` — unit tests for all attachment boundaries.
- `src/server/customer-service/providers/image-analysis-provider.ts` — provider contract.
- `src/server/customer-service/providers/mock-image-analysis.ts` — deterministic test/development provider.
- `src/server/customer-service/providers/openai-image-analysis.ts` — Responses API vision provider.
- `src/server/customer-service/providers/openai-image-analysis.test.ts` — request, output and privacy tests.
- `src/server/customer-service/image-analysis-schema.ts` — strict Zod result schema and safe prompt summary.
- `src/server/customer-service/image-analysis-schema.test.ts` — forbidden-field and enum tests.
- `src/server/customer-service/image-draft-validator.ts` — additive checks for unsupported visual conclusions.
- `src/server/customer-service/image-draft-validator.test.ts` — visual-claim validation without changing the existing validator.
- `src/server/customer-service/fixtures/image-evaluation-cases.jsonl` — 80 privacy-safe image evaluation records.
- `src/server/customer-service/fixtures/image-evaluation-assets/manifest.json` — provenance, consent and SHA-256 manifest.
- `scripts/evaluate-reply-assistant-images.ts` — image evaluation runner.
- `scripts/evaluate-reply-assistant-images.test.ts` — evaluation accounting and bypass tests.
- `scripts/cleanup-customer-service-attachments.ts` — 24-hour expiry cleanup command.
- `scripts/cleanup-customer-service-attachments.test.ts` — deletion selection tests.
- `drizzle/0023_reply_assistant_images.sql` and matching Drizzle snapshot — additive persistence migration.
- `docs/releases/2026-08-17-reply-assistant-image-aware-validation.md` — local, Staging and Meta Test Page evidence.

### Modify

- `src/server/customer-service/config.ts` and `config.test.ts` — server-only image feature configuration.
- `src/server/customer-service/types.ts` — normalized attachment support without changing text-only callers.
- `src/server/customer-service/adapters/facebook.ts` and test — parse image attachments and image-only messages.
- `src/server/customer-service/adapters/website.ts` and test — preserve disabled adapter while sharing the attachment contract.
- `src/server/db/schema/customer-service.ts` and schema tests — additive attachment and image-attempt tables.
- `src/server/customer-service/repositories/customer-service-repository.ts` — persistence, selection and image usage contracts.
- `src/server/customer-service/repositories/drizzle-customer-service-repository.ts` and integration test — DB-first attachment lifecycle and same-conversation selection.
- `src/server/customer-service/engine.ts` and test — policy-first image orchestration and safe fallback.
- `src/server/customer-service/prompt-builder.ts` and test — optional structured visual context.
- `src/server/customer-service/meta/webhook-handler.ts` and test — DB-first metadata, ephemeral source handoff and `after()` processing.
- `src/server/customer-service/runtime.ts` — construct image dependencies only when enabled.
- `src/server/customer-service/metrics.ts` and test — separate image calls, cost and latency.
- `src/app/reply-assistant/page.tsx` — image metrics and safe status.
- `src/components/reply-assistant/reply-assistant-client.tsx`, test and CSS — safe visual assessment display without image URLs.
- `src/server/customer-service/security-regression.test.ts`, `no-auto-send.test.ts`, `serverless-compatibility.test.ts` — regression boundaries.
- `package.json` — add only evaluation and cleanup scripts.

---

### Task 1: Freeze the Text Baseline and Add Disabled Configuration

**Files:**
- Modify: `src/server/customer-service/config.ts`
- Modify: `src/server/customer-service/config.test.ts`
- Modify: `src/server/customer-service/serverless-compatibility.test.ts`
- Read: `docs/superpowers/specs/2026-08-17-reply-assistant-image-aware-design.md`

**Interfaces:**
- Consumes: existing `parseCustomerServiceConfig(env)`.
- Produces: `imageAnalysisEnabled`, `imageAnalysisModel`, `metaAttachmentAllowedHosts` and `blobReadWriteToken` on `CustomerServiceConfig`.

- [ ] **Step 1: Run the frozen text checks before editing**

Run:

```bash
npm run test:run -- \
  src/server/customer-service/policy-regression.test.ts \
  src/server/customer-service/output-validator.test.ts \
  src/server/customer-service/no-auto-send.test.ts \
  scripts/evaluate-reply-assistant-quality.test.ts
```

Expected: all selected tests pass. Record the exact test count in the validation document; stop if the baseline is already red.

- [ ] **Step 2: Write failing configuration tests**

Add cases proving the flag defaults to false, no image secret is returned by `publicCustomerServiceConfig`, and enabling image analysis requires an image model, private Blob token and at least one HTTPS host:

```ts
expect(parseCustomerServiceConfig({}).imageAnalysisEnabled).toBe(false);
expect(() => parseCustomerServiceConfig({
  REPLY_ASSISTANT_ENABLED: "true",
  META_APP_SECRET: "app",
  META_VERIFY_TOKEN: "verify",
  META_PAGE_ID: "page",
  CUSTOMER_SERVICE_ID_HASH_SECRET: "hash",
  REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED: "true",
})).toThrow("OPENAI_IMAGE_ANALYSIS_MODEL is required");
```

- [ ] **Step 3: Verify the tests fail**

Run: `npm run test:run -- src/server/customer-service/config.test.ts`

Expected: FAIL because the new properties and validation do not exist.

- [ ] **Step 4: Implement the minimal server-only configuration**

Extend the frozen config type with:

```ts
imageAnalysisEnabled: boolean;
imageAnalysisModel: string;
metaAttachmentAllowedHosts: readonly string[];
blobReadWriteToken: string;
```

Parse `META_ATTACHMENT_ALLOWED_HOSTS` as comma-separated lowercase hostnames. When image analysis is enabled, require `OPENAI_IMAGE_ANALYSIS_MODEL`, `BLOB_READ_WRITE_TOKEN` and a non-empty host list. Do not add any `NEXT_PUBLIC_` variable.

- [ ] **Step 5: Verify configuration and text regressions**

Run:

```bash
npm run test:run -- src/server/customer-service/config.test.ts src/server/customer-service/serverless-compatibility.test.ts
npm run typecheck
```

Expected: PASS; text-only runtime construction remains valid with the image flag absent.

- [ ] **Step 6: Commit**

```bash
git add src/server/customer-service/config.ts src/server/customer-service/config.test.ts src/server/customer-service/serverless-compatibility.test.ts
git commit -m "feat: add disabled image analysis configuration"
```

---

### Task 2: Normalize Channel-Independent Image Attachments

**Files:**
- Create: `src/server/customer-service/attachments/types.ts`
- Create: `src/server/customer-service/attachments/limits.ts`
- Modify: `src/server/customer-service/types.ts`
- Modify: `src/server/customer-service/adapters/facebook.ts`
- Modify: `src/server/customer-service/adapters/facebook.test.ts`
- Modify: `src/server/customer-service/adapters/website.test.ts`

**Interfaces:**
- Produces:

```ts
export type AttachmentSourceRef =
  | Readonly<{ kind: "facebook_remote"; url: string }>
  | Readonly<{ kind: "website_private_upload"; storageKey: string }>;

export type NormalizedAttachment = Readonly<{
  externalAttachmentKey: string;
  ordinal: number;
  kind: "image";
  sourceRef: AttachmentSourceRef;
  mimeTypeHint: string | null;
}>;
```

- Extends `NormalizedIncomingMessage` with `text: string | null` and `attachments: readonly NormalizedAttachment[]`.

- [ ] **Step 1: Write failing adapter tests**

Cover a text-plus-image event, image-only event, non-image attachment, six-image event, echo event and malformed attachment. Assert that source URLs exist only in the normalized in-memory object:

```ts
expect(result[0]).toMatchObject({
  text: "Can you use this photo?",
  attachments: [{
    externalAttachmentKey: "mid.1:0",
    ordinal: 0,
    kind: "image",
    sourceRef: { kind: "facebook_remote", url: "https://scontent.test/image.jpg" },
  }],
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm run test:run -- src/server/customer-service/adapters/facebook.test.ts src/server/customer-service/adapters/website.test.ts`

Expected: FAIL because attachment fields and image-only normalization are absent.

- [ ] **Step 3: Add immutable limits**

Export exact constants:

```ts
export const IMAGE_LIMITS = Object.freeze({
  maxCount: 5,
  maxBytesPerImage: 4 * 1024 * 1024,
  maxBatchBytes: 12 * 1024 * 1024,
  maxPixels: 20_000_000,
  maxSidePixels: 8192,
  maxRedirects: 2,
  perImageTimeoutMs: 10_000,
  batchTimeoutMs: 20_000,
  retentionMs: 24 * 60 * 60 * 1000,
} as const);
```

- [ ] **Step 4: Implement Facebook normalization**

Use `message.attachments` entries whose `type` is `image` and whose `payload.url` is a non-empty HTTPS URL. Derive `externalAttachmentKey` as `${messageId}:${ordinal}`. Preserve at most five entries. Keep the Website adapter disabled but type-compatible.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test:run -- src/server/customer-service/adapters/facebook.test.ts src/server/customer-service/adapters/website.test.ts
npm run typecheck
```

Expected: PASS, with all existing text-only adapter cases unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/server/customer-service/attachments src/server/customer-service/types.ts src/server/customer-service/adapters
git commit -m "feat: normalize customer service image attachments"
```

---

### Task 3: Add Additive Attachment Persistence

**Files:**
- Modify: `src/server/db/schema/customer-service.ts`
- Modify: `src/server/db/schema/customer-service-schema.test.ts`
- Create: `drizzle/0023_reply_assistant_images.sql`
- Create: `drizzle/meta/0023_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `customerServiceAttachments`, `customerServiceImageAnalysisAttempts`, `customerServiceImageAnalysisInputs`.
- Preserves: every existing table and row.

- [ ] **Step 1: Write failing schema tests**

Assert that the new tables exist, raw URLs have no column, foreign keys use `restrict`, and `customer_service_messages.customer_text` is nullable:

```ts
expect(schema.customerServiceAttachments).toBeDefined();
expect(Object.keys(getTableColumns(schema.customerServiceAttachments))).not.toContain("sourceUrl");
expect(getTableColumns(schema.customerServiceMessages).customerText.notNull).toBe(false);
```

- [ ] **Step 2: Verify the schema tests fail**

Run: `npm run test:run -- src/server/db/schema/customer-service-schema.test.ts`

Expected: FAIL because the additive schema is absent.

- [ ] **Step 3: Add the schema**

Add `customerText: text("customer_text")` to messages. Define attachment rows with message ID, ordinal, kind, external key hash, status, MIME hints, verified MIME, dimensions, byte size, private storage key, SHA-256, failure code, expiry and deletion timestamps. Define image attempts with status, provider-called flag, provider/model, strict JSON result, tokens, cost, latency, error and timestamps. Define the join table with one unique attachment per attempt.

Use these status sets:

```ts
type AttachmentStatus = "metadata_received" | "stored" | "analyzed" | "rejected" | "failed" | "deleted";
type ImageAttemptStatus = "pending" | "provider_pending" | "analyzed" | "input_rejected" | "provider_error" | "schema_blocked";
```

- [ ] **Step 4: Generate and inspect the migration**

Run: `npm run db:generate`

Expected: Drizzle creates migration `0023` containing only `ALTER TABLE ... ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`, constraints and foreign keys. Rename the generated file to `0023_reply_assistant_images.sql` if Drizzle gives it a random suffix, and update the journal tag consistently.

- [ ] **Step 5: Prove the SQL is additive**

Run:

```bash
! rg -n 'DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER COLUMN.*TYPE' drizzle/0023_reply_assistant_images.sql
npm run db:check
```

Expected: both commands exit 0.

- [ ] **Step 6: Apply to the disposable database and rerun schema tests**

Run:

```bash
test -n "$TEST_DATABASE_URL"
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:run -- src/server/db/schema/customer-service-schema.test.ts
```

Expected: migration and tests PASS. Never substitute Staging or Production for `TEST_DATABASE_URL`.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema/customer-service.ts src/server/db/schema/customer-service-schema.test.ts drizzle
git commit -m "feat: persist reply assistant image analysis"
```

---

### Task 4: Validate, Download and Privately Store Images

**Files:**
- Create: `src/server/customer-service/attachments/image-validation.ts`
- Create: `src/server/customer-service/attachments/image-validation.test.ts`
- Create: `src/server/customer-service/attachments/facebook-source-reader.ts`
- Create: `src/server/customer-service/attachments/facebook-source-reader.test.ts`
- Create: `src/server/customer-service/attachments/private-attachment-store.ts`
- Create: `src/server/customer-service/attachments/private-attachment-store.test.ts`

**Interfaces:**
- Produces:

```ts
export type ResolvedAttachment = Readonly<{
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  sha256: string;
}>;

export interface AttachmentSourceReader {
  readonly channel: "facebook" | "website";
  read(source: AttachmentSourceRef, signal: AbortSignal): Promise<ResolvedAttachment>;
}
```

- [ ] **Step 1: Write failing security tests**

Test non-HTTPS URLs, credentials in URLs, IP literals, unapproved hosts, DNS-private addresses, redirect escape, declared oversize when Content-Length is present, streaming oversize with or without Content-Length, wrong magic bytes, unsupported MIME, 20MP overflow and an 8193-pixel side. Test that Blob paths match `customer-service-attachments/<uuid>.bin` and use `access: "private"`.

- [ ] **Step 2: Verify the tests fail**

Run: `npm run test:run -- src/server/customer-service/attachments`

Expected: FAIL because the secure reader and dedicated store do not exist.

- [ ] **Step 3: Implement validation**

Use file signatures for JPEG, PNG and WebP, then call `sharp(bytes, { failOn: "error", limitInputPixels: IMAGE_LIMITS.maxPixels }).metadata()`. Reject animation and dimensions outside the exact limits. Return only the safe `ResolvedAttachment` fields.

- [ ] **Step 4: Implement the bounded Facebook reader**

Validate every initial and redirect URL against the parsed host allowlist. Resolve DNS and reject loopback, private, link-local and unspecified IPv4/IPv6 addresses. Read the response stream with an incremental byte counter and an abort signal. Permit at most two redirects and never forward authorization or cookie headers.

- [ ] **Step 5: Implement the dedicated private Blob store**

Expose only:

```ts
save(attachment: ResolvedAttachment): Promise<{ storageKey: string }>;
read(storageKey: string): Promise<Buffer>;
remove(storageKey: string): Promise<void>;
```

Require `BLOB_READ_WRITE_TOKEN` when the image feature is enabled. Do not fall back to Vercel filesystem persistence.

- [ ] **Step 6: Verify**

Run:

```bash
npm run test:run -- src/server/customer-service/attachments
npm run typecheck
```

Expected: PASS, including redirect, DNS, stream limit, signature and private-access tests.

- [ ] **Step 7: Commit**

```bash
git add src/server/customer-service/attachments
git commit -m "feat: secure customer image ingestion"
```

---

### Task 5: Persist Metadata First and Enforce Conversation Isolation

**Files:**
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`

**Interfaces:**
- Extends `HashedIncomingMessage` with safe attachment metadata only.
- Produces:

```ts
selectImageContext(messageId: string): Promise<Readonly<{
  messageId: string;
  attachmentIds: readonly string[];
  analysisSummary: string | null;
}> | null>;
```

- [ ] **Step 1: Write failing integration tests**

Use two conversations and prove:

1. Message and attachment metadata commit in one transaction before processing begins.
2. A duplicate message creates no second attachment row.
3. The current message gets its own attachments.
4. A text-only message may select immediately preceding attachment-only messages from the same conversation within five minutes.
5. Selection stops at the first earlier text message.
6. Attachments from another conversation are never selected.
7. Selection returns at most five attachments.
8. Raw URLs are absent from every persisted row.

- [ ] **Step 2: Verify failure**

Run:

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:run -- src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
```

Expected: FAIL on missing attachment persistence methods.

- [ ] **Step 3: Implement DB-first ingestion**

Hash each `externalAttachmentKey` before calling the repository. Insert the message and attachment metadata atomically. For image-only messages, store `body = "[Image attachment]"` and `customerText = null`; for text messages, store the trimmed text in both compatibility `body` and `customerText`.

- [ ] **Step 4: Implement server-side context selection**

Query only by internal `messageId`, derive its conversation in SQL, apply the five-minute window, stop boundary and maximum count in repository code, and return no external or storage identifiers to callers that build browser DTOs.

- [ ] **Step 5: Verify**

Run:

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:run -- src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
npm run typecheck
```

Expected: PASS with zero cross-conversation rows.

- [ ] **Step 6: Commit**

```bash
git add src/server/customer-service/repositories
git commit -m "feat: persist isolated image message context"
```

---

### Task 6: Add Strict Image Analysis Schema and Provider

**Files:**
- Create: `src/server/customer-service/image-analysis-schema.ts`
- Create: `src/server/customer-service/image-analysis-schema.test.ts`
- Create: `src/server/customer-service/providers/image-analysis-provider.ts`
- Create: `src/server/customer-service/providers/mock-image-analysis.ts`
- Create: `src/server/customer-service/providers/openai-image-analysis.ts`
- Create: `src/server/customer-service/providers/openai-image-analysis.test.ts`

**Interfaces:**
- Produces `ImageAnalysisResult` with only: overall status, per-image classification, blur, resolution, subject scale, crop, obstruction, screenshot flag, recommended role, issue codes, comparison, recommendation codes and safe summary.
- Produces `ImageAnalysisProvider.analyze(request): Promise<ImageAnalysisProviderResult>`.

- [ ] **Step 1: Write failing schema tests**

Accept the approved enums and reject unknown keys, percentages, identity, age, ethnicity, health, emotion, attractiveness, price, ETA, restoration success and print suitability. Use `.strict()` on every nested Zod object.

- [ ] **Step 2: Write failing provider request tests**

Mock `fetch` and assert one Responses API request contains:

```ts
expect(body).toMatchObject({
  model: "approved-vision-model",
  store: false,
  tools: undefined,
  input: [{ role: "user", content: expect.arrayContaining([
    { type: "input_text", text: expect.any(String) },
    { type: "input_image", image_url: expect.stringMatching(/^data:image\/(jpeg|png|webp);base64,/) },
  ]) }],
});
```

Also assert no raw image, URL, sender ID or secret is included in errors or usage records.

- [ ] **Step 3: Verify failure**

Run:

```bash
npm run test:run -- src/server/customer-service/image-analysis-schema.test.ts src/server/customer-service/providers/openai-image-analysis.test.ts
```

Expected: FAIL because the schema and provider are absent.

- [ ] **Step 4: Implement the schema and safe summary renderer**

The renderer must translate only validated codes into short factual context such as `Image 1 appears to be a screenshot; request the original file.` It must not pass free-form model prose into the draft prompt.

- [ ] **Step 5: Implement mock and OpenAI providers**

Use `store: false`, no tools, base64 data URLs, `detail: "auto"`, strict JSON schema output, one request for the batch, and the existing usage/cost result shape. Map provider and schema failures to stable internal codes without response bodies.

- [ ] **Step 6: Verify**

Run:

```bash
npm run test:run -- src/server/customer-service/image-analysis-schema.test.ts src/server/customer-service/providers/openai-image-analysis.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/customer-service/image-analysis-schema* src/server/customer-service/providers
git commit -m "feat: add strict customer image analysis provider"
```

---

### Task 7: Add Policy-First Image Orchestration and Cleanup

**Files:**
- Create: `src/server/customer-service/attachments/attachment-processor.ts`
- Create: `src/server/customer-service/attachments/attachment-processor.test.ts`
- Modify: `src/server/customer-service/engine.ts`
- Modify: `src/server/customer-service/engine.test.ts`
- Modify: `src/server/customer-service/prompt-builder.ts`
- Modify: `src/server/customer-service/prompt-builder.test.ts`
- Create: `src/server/customer-service/image-draft-validator.ts`
- Create: `src/server/customer-service/image-draft-validator.test.ts`
- Modify: `src/server/customer-service/runtime.ts`

**Interfaces:**
- Extends internal draft generation with an optional ephemeral attachment source context; public generate/regenerate request bodies remain empty.
- Produces `image_review_required` when visual analysis cannot safely complete.

- [ ] **Step 1: Write failing call-order tests**

Use spies to prove:

```ts
expect(policyGate).toHaveBeenCalledBefore(sourceReader.read);
expect(sourceReader.read).toHaveBeenCalledBefore(imageProvider.analyze);
expect(imageProvider.analyze).toHaveBeenCalledBefore(textProvider.generate);
expect(outputValidator).toHaveBeenCalledAfter(textProvider.generate);
```

Add cases proving HIGH RISK, UNRESOLVED and REALTIME_REQUIRED call neither reader nor provider; image-only calls neither provider; invalid input and image-provider failure call no text provider; text-only calls no image dependency and produces the same prompt as the frozen baseline.

- [ ] **Step 2: Verify failure**

Run:

```bash
npm run test:run -- src/server/customer-service/engine.test.ts src/server/customer-service/attachments/attachment-processor.test.ts
```

Expected: FAIL on absent image stage and status.

- [ ] **Step 3: Implement the attachment processor**

For each terminal branch, execute deletion in `finally`. Persist safe state transitions and usage before returning. Do not retry automatically. Reserve image cost against the same daily and total budget rows before calling the image provider.

- [ ] **Step 4: Integrate the engine after the existing policy gate**

The order must be:

```text
load message -> text policy gate -> attachment context selection -> image analysis ->
confirmed knowledge retrieval -> prompt build -> text provider -> output validator -> human-review draft
```

If a validated previous analysis exists for the selected attachments, reuse its safe structured summary on manual regenerate without downloading again. If no safe analysis can be obtained, create a human-review attempt and stop.

- [ ] **Step 5: Add optional visual context to the prompt**

Add a separate `VISUAL ASSESSMENT` section generated from validated codes. State that it is advisory, cannot establish print suitability and cannot support a restoration guarantee. Do not include image bytes or URLs in the text provider prompt.

- [ ] **Step 6: Add a separate visual-claim validator**

Leave `output-validator.ts` unchanged. Add a second validator, used only when visual context exists, with codes for claims equivalent to `will restore`, `can definitely fix`, `perfect for printing`, `print quality is guaranteed` and `this photo is suitable for print`. A draft is accepted only when both the existing validator and the additive image validator pass.

- [ ] **Step 7: Verify orchestration and the frozen text path**

Run:

```bash
npm run test:run -- \
  src/server/customer-service/engine.test.ts \
  src/server/customer-service/prompt-builder.test.ts \
  src/server/customer-service/output-validator.test.ts \
  src/server/customer-service/image-draft-validator.test.ts \
  src/server/customer-service/policy-regression.test.ts
npm run typecheck
```

Expected: PASS; blocked cases have zero OpenAI calls and text-only prompt snapshots remain unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/server/customer-service/engine* src/server/customer-service/prompt-builder* src/server/customer-service/image-draft-validator* src/server/customer-service/runtime.ts src/server/customer-service/attachments/attachment-processor*
git commit -m "feat: gate image-aware reply drafts"
```

---

### Task 8: Connect the Meta Webhook Without Persisting Source URLs

**Files:**
- Modify: `src/server/customer-service/meta/webhook-handler.ts`
- Modify: `src/server/customer-service/meta/webhook-handler.test.ts`
- Modify: `src/app/api/meta/webhook/route-handler.ts`
- Modify: `src/app/api/meta/webhook/route.test.ts`

**Interfaces:**
- Consumes: normalized attachments and DB-first ingest.
- Produces: `after()` task receiving ephemeral attachment references only for newly created messages.

- [ ] **Step 1: Write failing webhook tests**

Prove signature and Page ID validation happen before adapter parsing, metadata commits before `scheduleAfter`, duplicates do not schedule, echoes do not ingest, wrong Page returns 403, and the persisted input has hashes but no raw URL:

```ts
expect(ingest.mock.invocationCallOrder[0]).toBeLessThan(scheduleAfter.mock.invocationCallOrder[0]);
expect(JSON.stringify(ingest.mock.calls)).not.toContain("scontent.test");
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/server/customer-service/meta/webhook-handler.test.ts src/app/api/meta/webhook/route.test.ts`

Expected: FAIL because attachment metadata and ephemeral handoff are not connected.

- [ ] **Step 3: Implement the DB-first handoff**

Hash conversation, message and attachment external keys. Call ingest with safe metadata. Only when status is `created`, close over the in-memory normalized attachment references inside `scheduleAfter` and call the image-aware engine. Continue returning HTTP 200 after persistence even when deferred processing fails.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test:run -- src/server/customer-service/meta/webhook-handler.test.ts src/app/api/meta/webhook/route.test.ts
npm run typecheck
```

Expected: PASS with no source URL in repository calls or response bodies.

- [ ] **Step 5: Commit**

```bash
git add src/server/customer-service/meta src/app/api/meta/webhook
git commit -m "feat: ingest Messenger images through deferred analysis"
```

---

### Task 9: Show Safe Image Status in the Human-Review UI

**Files:**
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/app/reply-assistant/page.tsx`
- Modify: `src/components/reply-assistant/reply-assistant-client.tsx`
- Modify: `src/components/reply-assistant/reply-assistant-client.test.tsx`
- Modify: `src/components/reply-assistant/reply-assistant.module.css`

**Interfaces:**
- Extends `SafeQueuePage.items` with `attachmentCount`, `imageAnalysisStatus` and `imageAssessmentSummary` only.
- Browser DTO must never include source URL, storage key, SHA-256, external key, sender hash or conversation hash.

- [ ] **Step 1: Write failing DTO and component tests**

Assert a safe summary is visible, image-only messages show `Human review required`, blocked visual analysis cannot generate or regenerate, and serialized props do not contain forbidden identifiers. At 390px, controls wrap and the textarea remains within the viewport.

- [ ] **Step 2: Verify failure**

Run:

```bash
npm run test:run -- src/components/reply-assistant/reply-assistant-client.test.tsx src/app/api/reply-assistant/messages/route.test.ts
```

Expected: FAIL because image status fields are absent.

- [ ] **Step 3: Implement safe queue projection**

Return only validated summary text and enum status. Render `Image assessment`, issue/recommendation text and `Human review required` without an image preview, remote URL or download control.

- [ ] **Step 4: Verify component and mobile layout**

Run:

```bash
npm run test:run -- src/components/reply-assistant/reply-assistant-client.test.tsx src/app/api/reply-assistant/messages/route.test.ts
npm run dev -- -H 0.0.0.0 -p 3001
```

Use the authenticated local Staging user at `http://192.168.4.199:3001/reply-assistant` and capture a 390x844 screenshot. Expected: no horizontal overflow, no exposed image reference, and all review controls remain manual.

- [ ] **Step 5: Commit**

```bash
git add src/server/customer-service/repositories src/app/reply-assistant src/components/reply-assistant
git commit -m "feat: show safe image review status"
```

---

### Task 10: Add Separate Image Cost Metrics and Expiry Cleanup

**Files:**
- Modify: `src/server/customer-service/metrics.ts`
- Modify: `src/server/customer-service/metrics.test.ts`
- Modify: `src/app/reply-assistant/page.tsx`
- Create: `scripts/cleanup-customer-service-attachments.ts`
- Create: `scripts/cleanup-customer-service-attachments.test.ts`
- Modify: `package.json`

**Interfaces:**
- Adds image calls, input/output/cached tokens, cost, average latency, failure count and cleanup count while preserving existing draft metrics.

- [ ] **Step 1: Write failing metrics and cleanup tests**

Assert text and image totals are separate, combined spend equals both, zero-call averages are zero, only expired non-deleted attachments are selected, deletion is idempotent, and storage deletion precedes setting `deleted_at`.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/server/customer-service/metrics.test.ts scripts/cleanup-customer-service-attachments.test.ts`

Expected: FAIL because image metrics and cleanup do not exist.

- [ ] **Step 3: Implement metrics and cleanup**

Add `reply-assistant:images:cleanup` to `package.json`. The script must print counts and stable error codes only, never storage keys or customer data. It must be safe to run repeatedly.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test:run -- src/server/customer-service/metrics.test.ts scripts/cleanup-customer-service-attachments.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/customer-service/metrics* src/app/reply-assistant/page.tsx scripts/cleanup-customer-service-attachments* package.json
git commit -m "feat: track and clean image analysis usage"
```

---

### Task 11: Build the 80-Case Image Evaluation

**Files:**
- Create: `src/server/customer-service/fixtures/image-evaluation-cases.jsonl`
- Create: `src/server/customer-service/fixtures/image-evaluation-assets/manifest.json`
- Create: `scripts/evaluate-reply-assistant-images.ts`
- Create: `scripts/evaluate-reply-assistant-images.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces a machine-readable report with gate result, visual codes, draft, policy violations, required-point coverage, provider calls, image and text tokens, image and text cost, latency and human-review requirement.

- [ ] **Step 1: Create privacy-safe assets and provenance**

Use only generated, team-owned, licensed or explicitly consented images. The manifest must record `assetId`, relative path, SHA-256, provenance category, consent status and permitted evaluation use. Do not include real Messenger downloads. Child imagery requires explicit consent or a generated asset.

- [ ] **Step 2: Write failing harness tests**

Assert exact case distribution: 12 blur, 10 screenshot, 8 small subject, 8 crop, 8 obstruction, 10 classification, 12 comparison, 6 blocked-policy controls and 6 provider/input failures. Assert blocked controls make zero vision and text calls.

- [ ] **Step 3: Verify failure**

Run: `npm run test:run -- scripts/evaluate-reply-assistant-images.test.ts`

Expected: FAIL because fixture and evaluator are absent.

- [ ] **Step 4: Implement the evaluator**

Add `reply-assistant:evaluate:images`. Write reports to a caller-supplied path with mode 0600. Redact source paths to asset IDs. Calculate visual issue coverage, request-original recall, assisted acceptance, bypass, policy violations, provider failures, separate token/cost totals and latency percentiles.

- [ ] **Step 5: Run mock evaluation**

Run:

```bash
npm run reply-assistant:evaluate:images -- \
  --fixture src/server/customer-service/fixtures/image-evaluation-cases.jsonl \
  --provider mock \
  --output /tmp/reply-assistant-image-eval-mock.json
```

Expected: 80 cases, gate bypass 0, policy violations 0, blocked provider calls 0, cross-customer exposure 0 and automatic sends 0.

- [ ] **Step 6: Run approved real-provider evaluation**

With `OPENAI_API_KEY` and `OPENAI_IMAGE_ANALYSIS_MODEL` already present in the server shell, run the same 80 cases with `--provider openai`. Do not print either environment value.

Acceptance: visual issue coverage at least 90%, request-original recall at least 90%, assisted acceptance at least 95%, rejected unsupported claims 0, policy bypass 0 and policy violations 0.

- [ ] **Step 7: Commit**

```bash
git add src/server/customer-service/fixtures/image-evaluation-cases.jsonl src/server/customer-service/fixtures/image-evaluation-assets scripts/evaluate-reply-assistant-images* package.json
git commit -m "test: add image-aware reply evaluation"
```

---

### Task 12: Complete Regression, Security and Test-Page Validation

**Files:**
- Modify: `src/server/customer-service/security-regression.test.ts`
- Modify: `src/server/customer-service/no-auto-send.test.ts`
- Modify: `src/server/customer-service/serverless-compatibility.test.ts`
- Create: `docs/releases/2026-08-17-reply-assistant-image-aware-validation.md`
- Modify only if evidence changes: `docs/releases/2026-08-17-reply-assistant-staging-validation.md`

**Interfaces:**
- Produces final PASS/FAIL evidence; no Production change.

- [ ] **Step 1: Add security regression tests**

Assert no send method, page token, image generation tool, client secret, raw source URL, persistent filesystem dependency or browser attachment identifier exists. Assert the image feature disabled path makes zero image calls.

- [ ] **Step 2: Run focused and complete local tests**

Run:

```bash
npm run knowledge:check
npm run lint
npm run typecheck
npm run test:run -- src/server/customer-service scripts/evaluate-reply-assistant-quality.test.ts scripts/evaluate-reply-assistant-images.test.ts
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:run
npm run build
```

Expected: all commands PASS. The full run must include the 18 database suites; a missing `TEST_DATABASE_URL` is a blocker, not a skip.

- [ ] **Step 3: Re-run the frozen 100-case text evaluation**

Run the unchanged text fixture and model settings used for the Phase 3.3 baseline:

```bash
npx tsx scripts/evaluate-reply-assistant-quality.ts \
  --fixture src/server/customer-service/fixtures/evaluation-cases.jsonl \
  --output /tmp/reply-assistant-phase-3-4-text-regression.json
```

Expected: bypass 0, violations 0, assisted acceptance at least 100%, required-point coverage at least 97.33%, and direct approval at least 78.33%. Record token and cost delta.

- [ ] **Step 4: Run secret and no-send scans**

Run:

```bash
! rg -n 'META_PAGE_ACCESS_TOKEN|graph\.facebook\.com/.*/messages|recipient\s*:' src scripts
! rg -n 'NEXT_PUBLIC_.*(OPENAI|META|BLOB|IMAGE|CUSTOMER_SERVICE)' src .env.example
! rg -n 'sourceRef|storageKey|externalAttachmentKey|externalKeyHash' src/components src/app/reply-assistant src/app/api/reply-assistant
git grep -nE 'sk-[A-Za-z0-9_-]{20,}|EAA[A-Za-z0-9]{20,}' -- . ':!package-lock.json'
```

Expected: the first three commands exit 0 and the credential pattern scan returns no matches.

- [ ] **Step 5: Validate on Vercel Preview and Meta Test Page only**

Deploy with `REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED=false`, verify auth and text regression, then enable it only in Preview. Configure the separate Test App/Test Page callback to the Preview `/api/meta/webhook`. Test low-risk image plus text, HIGH RISK plus image, REALTIME_REQUIRED plus image, duplicate delivery, echo, image-only, unsupported file and provider failure.

Expected: webhook 200 after DB-first persistence; normal low-risk case produces a human-review draft; blocked and image-only cases make zero OpenAI calls; duplicate creates no second analysis; echo is ignored; failure shows human review; no message is sent.

- [ ] **Step 6: Verify deletion and privacy evidence**

Confirm private Blob objects are removed on success, block and failure, and the cleanup command removes an artificially expired test object. Inspect Vercel logs and PostgreSQL rows for raw URLs, bytes, sender IDs, secrets and cross-customer identifiers; expected count is zero.

- [ ] **Step 7: Record environment status separately**

The validation report must contain three explicit rows:

```text
Local regression: PASS or FAIL, with exact commands and counts.
Staging DB/Test Page: PASS or FAIL, with Preview deployment and event evidence.
Production readiness: NOT READY until privacy/security and rollback owners sign; no Production changes performed.
```

- [ ] **Step 8: Final commit**

```bash
git add src/server/customer-service/security-regression.test.ts src/server/customer-service/no-auto-send.test.ts src/server/customer-service/serverless-compatibility.test.ts docs/releases/2026-08-17-reply-assistant-image-aware-validation.md docs/releases/2026-08-17-reply-assistant-staging-validation.md
git commit -m "test: validate image-aware reply assistant"
```

- [ ] **Step 9: Final candidate audit**

Run:

```bash
git status --short
git log --oneline --decorate -12
git diff origin/main...HEAD --stat
```

Expected: clean worktree, only Reply Assistant/knowledge/design/evaluation changes, no Production callback or feature-flag change, and no unrelated commerce changes.

---

## Completion Gate

Implementation is complete only when all of the following are true:

- Frozen text regression meets or exceeds every Phase 3.3 baseline.
- All unit tests and all database integration suites pass against an isolated disposable database.
- Image evaluation meets every acceptance threshold.
- HIGH RISK, UNRESOLVED and REALTIME_REQUIRED produce zero image and text provider calls.
- Invalid, image-only and failed-analysis paths require human review.
- Every output still passes the unchanged existing output validator and, when visual context exists, the additive image validator.
- No cross-customer attachment selection occurs.
- No raw URL, image byte, secret or unnecessary identity enters logs, DB usage rows, feedback or browser DTOs.
- Every temporary object is removed, with the 24-hour cleanup guard verified.
- No automatic send capability or Page access token exists.
- Meta evidence comes from the separate Test App/Test Page and Vercel Preview only.
- Production remains unchanged and Production readiness remains separately signed.
