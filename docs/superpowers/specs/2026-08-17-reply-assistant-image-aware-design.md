# Phase 3.4 Image-Aware Customer Service Design

Date: 2026-08-17

Status: DESIGN ONLY - NOT APPROVED FOR IMPLEMENTATION OR PRODUCTION

## 1. Goal

Extend the channel-independent R&R Customer Service Engine so it can inspect image attachments that belong to the same customer conversation as the current message, produce a constrained visual assessment, and use that assessment when generating a human-review draft.

The first release analyzes images only. It does not edit images, create designs, calculate prices, change orders, or send customer messages.

## 2. Frozen Phase 3.3 Baseline

The text-only path is a regression baseline:

- Direct approval rate: 78.33%
- Assisted acceptance rate: 100%
- Required-point coverage: 97.33%
- Policy bypasses: 0
- Policy violations: 0

Phase 3.4 must preserve the existing text-only request shape when no attachment is present. Release is blocked if the unchanged 100-case text evaluation falls below any baseline above, if the policy gate or output validator changes, or if a send capability appears.

## 3. Environment Status Clarification

### Local regression status

The current local shell does not contain `TEST_DATABASE_URL`. The Phase 3.3 full-repository run therefore produced:

- 1,581 passing tests;
- 18 database integration suites that stopped during module loading with `TEST_DATABASE_URL is required`;
- 78/78 focused non-database Customer Service tests passing;
- TypeScript, knowledge compilation/check, no-send test and secret scan passing;
- ESLint with zero errors and three existing warnings.

This means the current local working tree has not completed a fresh full database regression. It does not mean the 18 database suites found product defects.

### Staging database validation status

The recorded Staging validation used dedicated environment variables pointing to:

- `rnr_reply_assistant_test_20260817` for tests; and
- `rnr_reply_assistant_staging_20260817` for Preview persistence.

At that candidate, all migrations applied and 1,660 tests passed with zero failures or skips. Six `customer_service_*` tables were observed and the repository integration tests passed. The disposable test database was then removed. The current shell intentionally does not retain its URL.

This is valid historical Staging evidence for the tested candidate. Phase 3.3 did not modify the database schema or repository, but the historical result is not a substitute for rerunning database tests on a future Phase 3.4 candidate.

### Production readiness status

Production is NOT READY. The remaining recorded blockers are:

- real approved Meta Test App/Test Page webhook chain is still pending;
- security/privacy human sign-off is pending;
- rollback owner and confirmation time are pending;
- Phase 3.4 has not been implemented or validated.

Ronnie's AI quality sign-off is PASS for human-review assistant use only. It does not authorize autonomous replies.

## 4. Scope

### Supported initial visual tasks

- Customer photo versus design/reference image classification.
- Screenshot or edited-copy detection and original-file recommendation.
- Blur and low-resolution warning signals.
- Face too small in the frame.
- Heavy cropping.
- Obstruction of an important subject.
- Comparison of multiple photos supplied in one eligible attachment context.
- Likely main-photo versus side-photo recommendation.
- Request for a better, original, uncropped, or closer image where appropriate.

### Non-goals

- Image editing, restoration, enhancement or background removal.
- Design generation or mockups.
- Facial recognition or identity matching.
- Sensitive-trait inference.
- Print-suitability certification.
- Product feasibility, price, delivery, capacity or order decisions.
- Website Chat implementation.
- Messenger Send API or any automatic sending.
- Production environment, callback or feature-flag changes.

## 5. Architecture Decision

### Chosen approach: two-stage policy-gated analysis

1. Existing text policy gate runs first.
2. Eligible attachments are downloaded and validated server-side.
3. A vision-capable provider produces strict structured image analysis.
4. The structured result is validated and persisted without the raw image.
5. Existing knowledge retrieval loads only confirmed rules.
6. Existing text draft provider receives text context plus the safe structured visual summary.
7. Existing output validator runs unchanged.
8. Ronnie accepts, edits or rejects the draft. Nothing sends automatically.

This keeps image interpretation separate from business policy and makes failures auditable.

### Alternatives rejected

**One multimodal call that directly writes the customer reply:** cheaper, but it mixes visual inference with business policy, is harder to validate, and makes visual errors less observable.

**Large local computer-vision pipeline:** could provide deterministic image metrics, but adds unnecessary image-processing dependencies and still cannot reliably classify design references or make useful main-photo comparisons.

Local deterministic checks remain limited to file type, byte size, dimensions and decompression safety.

## 6. Channel-Independent Attachment Interface

The core engine receives normalized attachment descriptors. It does not know whether bytes came from Meta or Website Chat.

```ts
type NormalizedAttachment = Readonly<{
  externalAttachmentKey: string;
  ordinal: number;
  kind: "image";
  sourceRef: AttachmentSourceRef;
  mimeTypeHint: string | null;
}>;

type AttachmentSourceRef =
  | Readonly<{ kind: "facebook_remote"; url: string }>
  | Readonly<{ kind: "website_private_upload"; storageKey: string }>;

type NormalizedIncomingMessage = Readonly<{
  channel: "facebook" | "website";
  externalConversationKey: string;
  externalMessageKey: string;
  text: string | null;
  attachments: readonly NormalizedAttachment[];
  receivedAt: Date;
}>;

interface AttachmentSourceReader {
  readonly channel: "facebook" | "website";
  read(source: AttachmentSourceRef, limits: AttachmentLimits): Promise<ResolvedAttachment>;
}
```

`sourceRef` is server-only and ephemeral. It is never included in browser DTOs, logs, feedback records, prompts or PostgreSQL.

## 7. Facebook Attachment Ingestion

The Facebook adapter will read `message.attachments` from a signature-verified, Page-validated Meta webhook event.

Only `type: "image"` is accepted in Phase 3.4. Unsupported audio, video, file, sticker and location events are persisted as unsupported metadata and sent to human review without a model call.

The adapter will:

1. retain existing echo filtering;
2. derive a stable attachment key from message ID plus attachment ordinal when Meta provides no attachment ID;
3. keep the Meta CDN URL only in the in-memory `sourceRef`;
4. persist the message and attachment metadata before scheduling background work;
5. pass the ephemeral `sourceRef` into `after()` for immediate download;
6. return webhook HTTP 200 after database-first ingestion.

The Meta CDN URL must never be written to PostgreSQL or logs because it may contain temporary access material.

The Facebook source reader accepts HTTPS only, rejects credentials in URLs, blocks loopback/private/link-local destinations, limits redirects, and permits only the Meta CDN host suffixes proven by the approved Test Page fixture. If the development Test Page cannot supply an attachment URL that is readable without a Production Page token, Phase 3.4 Facebook image ingestion remains disabled. No Production credential may be introduced to work around that failure.

## 8. Future Website Chat Reuse

Website Chat is not implemented in this phase. Its future adapter will produce the same `NormalizedAttachment` type with `sourceRef.kind = "website_private_upload"`.

The future Website upload route must:

- authenticate or create a conversation-scoped guest session;
- store the upload in private object storage;
- return only an opaque attachment handle;
- bind the handle to one conversation before message creation;
- prevent a client from supplying an arbitrary attachment ID;
- use the same attachment limits, image analysis provider, schema validator, policy gate, knowledge retrieval, output validator, feedback and cost metrics.

No Website-specific AI engine is permitted.

## 9. Same-Conversation Isolation

The database message is the anchor. The server, not the browser, selects attachments.

Rules:

- Attachments directly present on the current message are eligible.
- If a text message has no attachment, the server may include immediately preceding attachment-only messages from the same `conversation_id`, received within five minutes, stopping at the first earlier text-bearing message.
- Maximum attachment count remains five.
- No attachment from another `conversation_id` can be selected, even if an ID is guessed or supplied by a client.
- The provider request is created from a repository result that joins message, conversation and attachment rows in one query/transaction boundary.
- Feedback and evaluation records contain no external conversation or sender identifier.

An image-only message has no safe textual intent. In the first release it is persisted but marked `NEEDS_HUMAN_REVIEW`; it does not invoke OpenAI automatically. This avoids inventing intent from an image.

## 10. Temporary Download and Storage

### Storage location

Use a dedicated private Vercel Blob prefix:

`customer-service-attachments/{attachmentUuid}.bin`

Do not use public Blob access and do not mix these objects with permanent order uploads or gallery assets.

### Lifecycle

1. Stream the Meta attachment into bounded server memory.
2. Validate bytes before storage.
3. Write to private Blob only after validation.
4. Read the object for the image-analysis request.
5. Delete the object immediately after successful analysis or terminal failure.
6. Record `delete_due_at` as a guard and run cleanup for any object older than 24 hours.

Raw image bytes are not stored in PostgreSQL. The source URL is never stored. The private Blob key is cleared from the attachment row after deletion.

Only non-sensitive operational metadata and the constrained analysis result may remain according to the Customer Service pilot retention policy.

## 11. File Limits and Validation

Phase 3.4 limits are deliberately lower than provider maximums:

- Formats: JPEG, PNG and WebP only.
- Maximum images per context: 5.
- Maximum encoded size per image: 4 MB.
- Maximum encoded size per provider request: 12 MB.
- Maximum decoded dimensions: 20 megapixels and 8,192 pixels on either side.
- Minimum dimension: no rejection; small images are analyzed and may receive a low-resolution warning.
- Redirects: maximum 2, with every destination revalidated.
- Download timeout: 10 seconds per image and 20 seconds for the batch.
- Content-Length is checked when present, but streaming byte limits remain authoritative.
- MIME header, file extension and magic bytes must agree.
- SVG, GIF, HEIC, TIFF, BMP, PDF and malformed images are not analyzed in the first release.

Oversized, unsupported or malformed content fails closed to human review. The system does not resize, transcode or repair customer images.

## 12. Model Input

The image-analysis provider uses the OpenAI Responses API with:

- a separately configured, allowlisted vision-capable model;
- `store: false`;
- one `input_text` instruction block;
- one `input_image` block per validated image;
- base64 data URLs created server-side from private Blob bytes;
- `detail: "auto"` initially;
- strict structured JSON output;
- no tools and no image-generation capability.

The current text model and text-only provider request remain unchanged. The image model is controlled by a separate server-only `OPENAI_IMAGE_ANALYSIS_MODEL` setting and cannot silently fall back to another model.

Official OpenAI documentation supports image URL/data input through `input_image` in the Responses API. Image inputs may also be subject to platform safety scanning and retention exceptions; this must be included in the privacy sign-off before any customer-image pilot.

The second, text-draft call receives only the validated structured result, not the raw image. This avoids sending the same image twice and keeps business drafting auditable.

## 13. Image Analysis Result Schema

```ts
type ImageAnalysisResult = Readonly<{
  schemaVersion: "1";
  overallStatus: "assessed" | "unclear" | "human_review_required";
  images: readonly Readonly<{
    ordinal: number;
    classification:
      | "customer_photo"
      | "design_reference"
      | "screenshot_of_photo"
      | "screenshot_of_design"
      | "price_or_ad_reference"
      | "unknown";
    blur: "none_visible" | "mild" | "strong" | "unclear";
    sourceResolutionSignal: "normal" | "low" | "very_low" | "unclear";
    subjectScale: "large" | "usable" | "small" | "very_small" | "unclear";
    crop: "none_visible" | "mild" | "heavy" | "unclear";
    obstruction: "none_visible" | "mild" | "heavy" | "unclear";
    screenshotSignal: "none_visible" | "possible" | "likely" | "unclear";
    recommendedRole: "main_candidate" | "side_candidate" | "reference_only" | "unclear";
    issueCodes: readonly (
      | "request_original"
      | "request_uncropped"
      | "request_closer_subject"
      | "request_less_obstructed"
      | "request_alternative"
      | "manual_assessment"
    )[];
  }>;
  comparison: Readonly<{
    likelyMainOrdinal: number | null;
    likelySideOrdinals: readonly number[];
    confidence: "low" | "medium";
    reasonCodes: readonly (
      | "larger_subject"
      | "less_blur"
      | "less_crop"
      | "less_obstruction"
      | "better_composition"
      | "unclear"
    )[];
  }> | null;
  recommendationCodes: readonly (
    | "send_original_file"
    | "send_uncropped_version"
    | "send_closer_photo"
    | "send_alternative_photo"
    | "use_as_main_candidate"
    | "use_as_side_candidate"
    | "human_review"
  )[];
  safeSummary: string;
}>;
```

The schema intentionally has no `printSuitable`, restoration success, price, delivery, product feasibility, identity, age, ethnicity, health, attractiveness or emotion fields.

Validation requirements:

- strict enums and `additionalProperties: false`;
- maximum five image records;
- ordinals must match the submitted attachment set;
- summary maximum 300 characters;
- no names, identity claims or sensitive-trait descriptions;
- no business-policy language;
- no claim that a photo can definitely be restored, printed or used.

An invalid schema result is discarded and cannot enter the draft prompt.

## 14. Policy Gate and Knowledge Integration

The existing policy gate remains the first model boundary.

```text
incoming text + attachment metadata
  -> existing text policy gate
  -> blocked: persist gate result, zero model calls
  -> allowed: validate/download images
  -> image analysis provider
  -> strict image schema validator
  -> confirmed knowledge retrieval
  -> text draft provider
  -> unchanged output validator
  -> human review UI
```

Rules:

- `HIGH RISK`, `UNRESOLVED` and `REALTIME_REQUIRED` produce zero image and text provider calls.
- Visual analysis can add caution or require human review; it cannot turn a blocked message into an allowed one.
- Visual classification never supplies prices, ETA, product availability, restoration promises or order status.
- `recommendationCodes` map only to confirmed photo/design knowledge such as requesting the original file and explaining quality limitations.
- If visual observations and customer text conflict, escalate to human review.
- Existing text output validator remains mandatory and unchanged.
- A new image-schema validator is additive; it does not replace or weaken the text validator.

## 15. Persistence Design

Use additive PostgreSQL tables:

### `customer_service_attachments`

- `id`
- `message_id` foreign key
- `external_attachment_key_hash`
- `ordinal`
- `kind`
- `mime_type`
- `byte_size`
- `width`
- `height`
- `status`
- `private_storage_key` nullable
- `delete_due_at` nullable
- timestamps

No source URL, raw bytes, sender ID or webhook payload is stored.

### `customer_service_image_analysis_attempts`

- `id`
- `message_id` foreign key
- `attempt_number`
- `status`
- `provider_called`
- `provider`
- `model`
- `schema_version`
- validated `analysis_result` JSONB nullable
- `validator_codes`
- input/cached/output tokens
- estimated cost in micro-USD
- latency
- provider error code
- timestamps

### `customer_service_image_analysis_inputs`

- `analysis_attempt_id` foreign key
- `attachment_id` foreign key
- `ordinal`

The join table proves exactly which same-message/same-conversation images entered an analysis and prevents an untracked attachment list in JSON.

The existing message body column remains compatible. An additive nullable `customer_text` column distinguishes real customer text from the internal image-only compatibility marker. Existing rows fall back to `body`; new model calls use `customer_text` only.

## 16. Privacy and Security

- Better Auth admin/staff authorization continues to protect all UI and APIs.
- Meta signature and Page validation occur before attachment ingestion.
- Raw external IDs remain HMAC-hashed.
- Raw attachment URLs are neither logged nor persisted.
- Private Blob access is server-only.
- Browser DTOs expose neither storage keys nor source URLs.
- Provider input is limited to current same-conversation text and selected images.
- No facial recognition, identity linking, sensitive-trait inference or cross-conversation comparison.
- OpenAI requests use `store: false`; provider data handling must be included in signed privacy review.
- Image analysis results are redacted and structured, not free-form biographies.
- Feedback datasets may store structured issue/recommendation codes and the final reply, but not raw customer images.
- Evaluation images must be synthetic, team-owned, licensed for testing, or used with explicit consent.
- Images of children must not enter the reusable evaluation dataset without explicit recorded consent.
- Deletion failures create an operational alert and remain visible until cleanup succeeds.

## 17. Cost and Usage Accounting

Image analysis cost is recorded separately from text drafting:

- operation: `image_analysis` or `draft_generation`;
- model;
- image count;
- total validated bytes;
- input tokens;
- cached input tokens;
- output tokens;
- estimated cost;
- latency;
- gate result;
- provider/validator failure code.

Dashboard metrics add:

- image contexts received;
- image analyses attempted/succeeded/blocked/failed;
- average image-analysis cost;
- average image-analysis latency;
- total image-analysis cost;
- average total cost per image-aware draft;
- request-original recommendation rate;
- human direct/edit/reject rates for image-aware drafts.

The existing daily and total hard budgets cover the combined reserved cost of image analysis plus text drafting. Budget failure occurs before the image provider call and results in human review.

## 18. Evaluation Dataset

Create an image-aware dataset separate from the frozen text fixture. Initial target: 80 cases.

- 12 blur/low-resolution cases.
- 10 screenshot/original-file cases.
- 8 small-subject cases.
- 8 heavy-crop cases.
- 8 obstruction cases.
- 10 customer-photo versus design/reference cases.
- 12 multiple-photo comparison cases.
- 6 HIGH RISK or REALTIME_REQUIRED text-plus-image controls.
- 6 malformed, oversized, unsupported, timeout or provider-failure controls.

Each case records:

- synthetic conversation key;
- de-identified customer text;
- one to five licensed/test images;
- expected policy-gate decision;
- expected image classifications and issue codes;
- acceptable recommendation codes;
- forbidden claims;
- expected fallback;
- Ronnie rating and human final reply when reviewed.

Acceptance gates:

- Frozen 100-case text baseline does not regress.
- Policy bypasses: 0.
- Policy violations: 0.
- Cross-customer attachment exposures: 0.
- Automatic sends: 0.
- HIGH RISK/UNRESOLVED/REALTIME_REQUIRED image provider calls: 0.
- Invalid/oversized/unsupported inputs fail closed: 100%.
- Required visual issue-code coverage: at least 90%.
- Original-file recommendation recall on screenshot/low-quality cases: at least 90%.
- Image-aware assisted acceptance in Ronnie review: at least 95%.
- No rejected draft caused by an unsupported restoration, print, price or delivery claim.

Before any live pilot, Ronnie reviews at least 20 representative image-aware drafts and explicitly signs PASS for human-review use only.

## 19. Failure and Fallback Behaviour

The system fails closed for:

- attachment download failure;
- unsupported or malformed image;
- size or decompression limit;
- Blob read/write/delete failure;
- model timeout/refusal/provider error;
- invalid structured output;
- attachment/context mismatch;
- budget hard stop;
- visual/text conflict.

Fallback behavior:

1. persist a non-sensitive failure code;
2. delete temporary bytes where present;
3. do not create an image-aware customer draft;
4. mark `NEEDS_HUMAN_REVIEW` in the internal UI;
5. tell the operator to inspect the original attachment in Meta Business Suite;
6. make zero send attempts;
7. do not silently continue with invented visual observations.

Automatic retries are not allowed in the first release. Ronnie may manually request a new analysis only while the private object is still within its retention window; otherwise the customer must resend the image.

## 20. Feature Flags and Rollout Boundary

Use separate server-only flags:

- `REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED=false` by default;
- `OPENAI_IMAGE_ANALYSIS_MODEL` required before enabling;
- image limits and retention configured server-side only.

Rollout sequence, after a separately approved implementation plan:

1. local unit and isolated database tests;
2. frozen text regression;
3. synthetic image evaluation;
4. Vercel Preview with Test App/Test Page only;
5. Ronnie 20-case image-aware quality sign-off;
6. security/privacy and retention sign-off;
7. limited human-review pilot.

This design does not authorize changing the Production Meta callback, Production feature flag, Production database, Website Chat, or any sending capability.

## 21. Implementation Preconditions

Implementation may begin only after this design is approved and a TDD plan is written. Before a live image pilot, all of the following must be proven:

- approved Meta development App and non-Production Test Page deliver real image attachments;
- exact Meta CDN hosts and URL behavior are captured from the test fixture;
- attachment download works without introducing a Production Page access token;
- selected OpenAI image model supports the required Responses API image input;
- privacy reviewer accepts provider image handling and 24-hour maximum raw-image retention;
- independent `TEST_DATABASE_URL` is available for all attachment persistence and isolation tests;
- security/privacy and rollback owners sign the existing checklist.

