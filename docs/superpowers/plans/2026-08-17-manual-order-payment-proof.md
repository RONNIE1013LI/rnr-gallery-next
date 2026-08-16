# Manual Order Payment Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add finance-protected payment-proof upload to manual Order Entry, supporting images and PDF while guaranteeing that a new manual order is not marked Processing or Paid until its proof has been stored.

**Architecture:** Reuse the existing private production-file system and `payment_proof` kind. Add a purpose-scoped PDF option to the private upload stores, expose the existing file-upload permission to `ProductionJobForm`, and orchestrate create-as-awaiting → upload-proof → update-final-status with stable idempotency keys and recoverable client state.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Drizzle ORM, Vercel Blob/local private storage, Vitest, Testing Library.

## Global Constraints

- Accept JPG, PNG, WebP, HEIC, HEIF and PDF files up to 25 MB.
- PDF is enabled only for `payment_proof`; customer photos, design drafts, print files and checkout uploads remain image-only.
- `Processing` and `Paid` require a selected proof during manual Order Entry.
- A paid/processing manual order is created as `Awaiting payment`, then the proof is uploaded, then the final payment status is saved.
- Payment proof upload, listing and download remain protected by existing file and finance permissions.
- Do not write file contents, original filenames or customer details to logs, analytics, localStorage or sessionStorage.
- Do not change Stripe, Afterpay, checkout, prices, GST, invoices, order numbering, completed online orders or the separate five-day original-photo cleanup feature.
- Preserve unrelated untracked workspace files.

## File Structure

- `src/server/uploads/local-private-upload-store.ts`: purpose-scoped validation and local persistence for PDF-capable payment proofs.
- `src/server/uploads/blob-private-upload-store.ts`: apply the same validation before private Vercel Blob writes.
- `src/server/uploads/local-private-upload-store.test.ts`: local image/PDF signature and default-denial tests.
- `src/server/uploads/private-upload-store.test.ts`: Blob PDF allow/deny regression tests.
- `src/server/production/production-proof-service.ts`: allow `application/pdf` only for `payment_proof` metadata.
- `src/server/production/production-proof-service.test.ts`: service-level kind/MIME and finance-permission tests.
- `src/app/api/admin/jobs/[jobId]/files/route-handler.ts`: enable PDF only after parsing payment-proof kind.
- `src/app/api/admin/jobs/[jobId]/files/route.test.ts`: admin route validation-option test.
- `src/app/api/forms/jobs/[jobId]/files/route-handler.ts`: equivalent Forms route option, preserving assignment checks.
- `src/app/api/forms/jobs/[jobId]/files/route.test.ts`: Forms route validation-option test.
- `src/server/production/production-job-service.ts`: return the new manual job's optimistic-lock timestamp.
- `src/server/production/drizzle-production-job-repository.ts`: select and return `updatedAt` for created and idempotently reused manual jobs.
- `src/server/production/production-job-service.test.ts`: identity timestamp contract test fixtures.
- `src/server/production/drizzle-production-job-repository.integration.test.ts`: repository timestamp result test.
- `src/components/admin/production-job-form.tsx`: payment-proof field, validation, sequenced submission and recovery.
- `src/components/admin/production-job-form.test.tsx`: UI, permissions, sequencing and failure-retry tests.
- `src/components/admin/production-files-panel.tsx`: permit PDF selection only when saved-order purpose is Payment proof.
- `src/components/admin/production-files-panel.test.tsx`: saved-order accept-filter test.
- `src/components/forms/forms-workbench.tsx`: add `canUploadFiles` to Order Entry data.
- `src/components/forms/forms-order-entry-drawer.tsx`: pass file-upload capability to the shared form.
- `src/components/forms/forms-order-entry-drawer.test.tsx`: permission-prop fixture and dirty-file regression.
- `src/app/forms/(portal)/page.tsx`: populate drawer Order Entry upload permission.
- `src/app/forms/(portal)/new/page.tsx`: populate standalone Order Entry upload permission.
- `src/app/admin/jobs/new/page.tsx`: populate the same permission for the existing shared admin form.

---

### Task 1: Purpose-scoped PDF validation in private storage

**Files:**
- Modify: `src/server/uploads/local-private-upload-store.ts`
- Modify: `src/server/uploads/blob-private-upload-store.ts`
- Test: `src/server/uploads/local-private-upload-store.test.ts`
- Test: `src/server/uploads/private-upload-store.test.ts`

**Interfaces:**
- Produces: `PrivateUploadValidationOptions = Readonly<{ allowPdf?: boolean }>`.
- Produces: `validatePrivateUpload(file, options?)`, `hasPrivateUploadSignature(bytes, mimeType, options?)`, and `save(file, options?)` on both private stores.
- Default: omitting options keeps the current image-only behaviour.

- [ ] **Step 1: Write failing local-store tests for explicit PDF support and default denial**

Add tests using a minimal valid header:

```ts
const pdf = new File(
  [new TextEncoder().encode("%PDF-1.7\n")],
  "bank-receipt.pdf",
  { type: "application/pdf" },
);

await expect(store.save(pdf)).rejects.toThrow(
  "Choose a JPG, PNG, WebP, HEIC or HEIF image.",
);
await expect(store.save(pdf, { allowPdf: true })).resolves.toMatchObject({
  originalName: "bank-receipt.pdf",
  mimeType: "application/pdf",
});
await expect(store.save(
  new File(["not pdf"], "fake.pdf", { type: "application/pdf" }),
  { allowPdf: true },
)).rejects.toThrow("contents do not match");
```

- [ ] **Step 2: Run the local-store test and verify the new call fails**

Run: `npm test -- src/server/uploads/local-private-upload-store.test.ts`

Expected: FAIL because `save` does not accept the options argument and PDF is rejected.

- [ ] **Step 3: Implement explicit PDF validation without changing the default**

Use these contracts:

```ts
export type PrivateUploadValidationOptions = Readonly<{ allowPdf?: boolean }>;

export function validatePrivateUpload(
  file: Pick<UploadFile, "type" | "size">,
  options: PrivateUploadValidationOptions = {},
) {
  const accepted = ACCEPTED_IMAGE_MIME_TYPES.has(file.type) ||
    (options.allowPdf === true && file.type === "application/pdf");
  if (!accepted) {
    throw new InvalidUploadError(
      options.allowPdf
        ? "Choose a JPG, PNG, WebP, HEIC, HEIF or PDF file."
        : "Choose a JPG, PNG, WebP, HEIC or HEIF image.",
    );
  }
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    throw new InvalidUploadError("Each file must be between 1 byte and 25 MB.");
  }
}
```

Rename `hasImageSignature` to `hasPrivateUploadSignature`, preserve all image checks, and add:

```ts
if (mimeType === "application/pdf" && options.allowPdf === true) {
  return bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-";
}
```

Pass `options` through `LocalPrivateUploadStore.save` and `BlobPrivateUploadStore.save`. Use the neutral error text `The file contents do not match the selected file type.`

- [ ] **Step 4: Add the equivalent private Blob test**

Call `store.save(pdf, { allowPdf: true })` and assert the Blob write uses `contentType: "application/pdf"`. Add a second assertion that `store.save(pdf)` rejects and does not call `put`.

- [ ] **Step 5: Run focused storage tests**

Run: `npm test -- src/server/uploads/local-private-upload-store.test.ts src/server/uploads/private-upload-store.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the storage boundary**

```bash
git add src/server/uploads/local-private-upload-store.ts src/server/uploads/blob-private-upload-store.ts src/server/uploads/local-private-upload-store.test.ts src/server/uploads/private-upload-store.test.ts
git commit -m "feat: allow scoped private PDF uploads"
```

---

### Task 2: Restrict PDF metadata to payment proofs and enable it in protected routes

**Files:**
- Modify: `src/server/production/production-proof-service.ts`
- Test: `src/server/production/production-proof-service.test.ts`
- Modify: `src/app/api/admin/jobs/[jobId]/files/route-handler.ts`
- Test: `src/app/api/admin/jobs/[jobId]/files/route.test.ts`
- Modify: `src/app/api/forms/jobs/[jobId]/files/route-handler.ts`
- Test: `src/app/api/forms/jobs/[jobId]/files/route.test.ts`

**Interfaces:**
- Consumes: `save(file, { allowPdf: boolean })` from Task 1.
- Produces: payment-proof references may use `mimeType: "application/pdf"`; all other production file kinds remain image-only.

- [ ] **Step 1: Write failing production-proof MIME tests**

Add a PDF reference and assert:

```ts
const pdfReference = {
  ...reference,
  originalName: "receipt.pdf",
  mimeType: "application/pdf",
};

await expect(service.registerFile(actor, jobId, {
  kind: "payment_proof",
  idempotencyKey: "payment-proof-pdf-1",
  reference: pdfReference,
}, { canManageFinance: true })).resolves.toMatchObject({ result: "created" });

await expect(service.registerFile(actor, jobId, {
  kind: "customer_file",
  idempotencyKey: "customer-file-pdf-1",
  reference: pdfReference,
}, { canManageFinance: true })).rejects.toBeInstanceOf(ProductionProofValidationError);
```

Keep the existing test that non-finance staff cannot register `payment_proof`.

- [ ] **Step 2: Run the service test and verify PDF payment proof fails**

Run: `npm test -- src/server/production/production-proof-service.test.ts`

Expected: FAIL because `application/pdf` is not in the reference MIME schema.

- [ ] **Step 3: Implement kind-aware service validation**

Allow `application/pdf` in the reference MIME enum, then add a `superRefine` rule:

```ts
if (file.kind !== "payment_proof" && file.reference.mimeType === "application/pdf") {
  context.addIssue({
    code: "custom",
    path: ["reference", "mimeType"],
    message: "PDF is only allowed for payment proof",
  });
}
```

Do not loosen kind validation, file size, storage key or SHA-256 validation.

- [ ] **Step 4: Write failing route tests for the scoped storage option**

For both admin and Forms job-file route tests, use a finance-authorised access fixture and assert:

```ts
expect(save).toHaveBeenCalledWith(
  expect.any(File),
  { allowPdf: true },
);
```

For `design_draft`, assert `{ allowPdf: false }`. Retain the Forms assignment-scope assertion and the existing pre-save finance rejection.

- [ ] **Step 5: Pass purpose-scoped validation to storage in both routes**

After the route has validated `kind`, `idempotencyKey` and `file`, call:

```ts
saved = await deps.save(file, { allowPdf: kind === "payment_proof" });
```

Do not enable this option in `/api/uploads` or any checkout/customer route.

- [ ] **Step 6: Run proof service and route tests**

Run: `npm test -- src/server/production/production-proof-service.test.ts 'src/app/api/admin/jobs/[jobId]/files/route.test.ts' 'src/app/api/forms/jobs/[jobId]/files/route.test.ts'`

Expected: PASS.

- [ ] **Step 7: Commit the payment-proof boundary**

```bash
git add src/server/production/production-proof-service.ts src/server/production/production-proof-service.test.ts 'src/app/api/admin/jobs/[jobId]/files/route-handler.ts' 'src/app/api/admin/jobs/[jobId]/files/route.test.ts' 'src/app/api/forms/jobs/[jobId]/files/route-handler.ts' 'src/app/api/forms/jobs/[jobId]/files/route.test.ts'
git commit -m "feat: accept PDF payment proofs"
```

---

### Task 3: Return the manual job optimistic-lock timestamp

**Files:**
- Modify: `src/server/production/production-job-service.ts`
- Modify: `src/server/production/drizzle-production-job-repository.ts`
- Test: `src/server/production/production-job-service.test.ts`
- Test: `src/server/production/drizzle-production-job-repository.integration.test.ts`
- Test: `src/app/api/admin/jobs/route.test.ts`
- Test: `src/app/api/forms/jobs/route.test.ts`

**Interfaces:**
- Produces: `ProductionJobIdentity` gains `updatedAt: Date` and both manual-create APIs serialize it as an ISO timestamp.
- Later task consumes: `result.job.updatedAt` as `expectedUpdatedAt` for the final finance update.

- [ ] **Step 1: Update tests to require `updatedAt` in created and duplicate identities**

Use a fixed date and expect:

```ts
const createdAt = new Date("2026-08-17T00:00:00.000Z");
expect(result.job).toMatchObject({
  id: expect.any(String),
  jobNumber: expect.any(String),
  updatedAt: createdAt,
});
```

Update route fixtures so API responses include `updatedAt: createdAt.toISOString()` after JSON serialization.

- [ ] **Step 2: Run job service/repository/route tests and verify type or assertion failures**

Run: `npm test -- src/server/production/production-job-service.test.ts src/server/production/drizzle-production-job-repository.integration.test.ts src/app/api/admin/jobs/route.test.ts src/app/api/forms/jobs/route.test.ts`

Expected: FAIL because `ProductionJobIdentity` currently has no `updatedAt`.

- [ ] **Step 3: Extend the identity and repository selects**

Change the identity contract to:

```ts
export type ProductionJobIdentity = Readonly<{
  id: string;
  jobNumber: string;
  requestDigest: string;
  updatedAt: Date;
}>;
```

Include `productionJobs.updatedAt` in `findManualByIdempotencyKey` and the `createManual(...).returning(...)` selection. Return it in both the normal create path and idempotent duplicate path.

- [ ] **Step 4: Run the focused identity tests**

Run: `npm test -- src/server/production/production-job-service.test.ts src/server/production/drizzle-production-job-repository.integration.test.ts src/app/api/admin/jobs/route.test.ts src/app/api/forms/jobs/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the response contract**

```bash
git add src/server/production/production-job-service.ts src/server/production/drizzle-production-job-repository.ts src/server/production/production-job-service.test.ts src/server/production/drizzle-production-job-repository.integration.test.ts src/app/api/admin/jobs/route.test.ts src/app/api/forms/jobs/route.test.ts
git commit -m "feat: return manual job update version"
```

---

### Task 4: Expose the payment-proof control only to authorised entry users

**Files:**
- Modify: `src/components/admin/production-job-form.tsx`
- Test: `src/components/admin/production-job-form.test.tsx`
- Modify: `src/components/forms/forms-workbench.tsx`
- Modify: `src/components/forms/forms-order-entry-drawer.tsx`
- Test: `src/components/forms/forms-order-entry-drawer.test.tsx`
- Modify: `src/app/forms/(portal)/page.tsx`
- Modify: `src/app/forms/(portal)/new/page.tsx`
- Modify: `src/app/admin/jobs/new/page.tsx`

**Interfaces:**
- Produces: `ProductionJobForm` prop `canUploadFiles?: boolean`, defaulting to `false`.
- Produces: `FormsOrderEntryData.canUploadFiles: boolean`.
- UI contract: field label `Payment proof`; accept list `image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf`.

- [ ] **Step 1: Write failing permission and field tests**

Assert the control is present only when both permissions are true:

```tsx
const { rerender } = render(
  <ProductionJobForm assignees={assignees} canManageFinance canUploadFiles />,
);
expect(screen.getByLabelText("Payment proof")).toHaveAttribute(
  "accept",
  "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf",
);

rerender(<ProductionJobForm assignees={assignees} canManageFinance canUploadFiles={false} />);
expect(screen.queryByLabelText("Payment proof")).not.toBeInTheDocument();
```

Also test `canManageFinance={false}` with `canUploadFiles` true.

- [ ] **Step 2: Run the component test and verify the control is absent**

Run: `npm test -- src/components/admin/production-job-form.test.tsx`

Expected: FAIL because `canUploadFiles` and the file input do not exist.

- [ ] **Step 3: Add the prop and field using existing form styling**

Add `canUploadFiles?: boolean` to props, default it to `false`, and replace the old hint with:

```tsx
{canUploadFiles ? <label className={styles.fullField}>
  <span>Payment proof</span>
  <input
    name="paymentProof"
    type="file"
    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
    aria-describedby="payment-proof-help payment-proof-error"
    disabled={pending}
  />
  <small id="payment-proof-help">JPG, PNG, WebP, HEIC, HEIF or PDF. Maximum 25 MB.</small>
</label> : null}
```

Render a dedicated error element with `id="payment-proof-error"`, `role="alert"`, and the component's existing field-hint/error styling.

- [ ] **Step 4: Pass upload permission through every shared form entry point**

- Add `canUploadFiles` to `FormsOrderEntryData`.
- In `/order-system`, set it with `hasFormPermission(..., "upload_files")` and pass through `FormsOrderEntryDrawer`.
- In `/order-system/new`, compute and pass the same Forms permission.
- In `/admin/jobs/new`, pass `hasAdminPermission(access.adminRole, "upload_production_files")`.
- Update drawer/workbench test fixtures with `canUploadFiles: true`.

- [ ] **Step 5: Test drawer dirty state from a file selection**

Select a small JPEG in the drawer, click Close, and assert the existing discard confirmation appears. This verifies `onChangeCapture` treats the proof as unsaved work.

- [ ] **Step 6: Run form and drawer tests**

Run: `npm test -- src/components/admin/production-job-form.test.tsx src/components/forms/forms-order-entry-drawer.test.tsx src/components/forms/forms-workbench.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the authorised UI**

```bash
git add src/components/admin/production-job-form.tsx src/components/admin/production-job-form.test.tsx src/components/forms/forms-workbench.tsx src/components/forms/forms-order-entry-drawer.tsx src/components/forms/forms-order-entry-drawer.test.tsx src/components/forms/forms-workbench.test.tsx 'src/app/forms/(portal)/page.tsx' 'src/app/forms/(portal)/new/page.tsx' src/app/admin/jobs/new/page.tsx
git commit -m "feat: add manual payment proof field"
```

---

### Task 5: Sequence create, proof upload and final payment status with recovery

**Files:**
- Modify: `src/components/admin/production-job-form.tsx`
- Test: `src/components/admin/production-job-form.test.tsx`

**Interfaces:**
- Consumes: `result.job.updatedAt` from Task 3.
- Consumes: protected `${endpoint}/${jobId}/files` upload route from Task 2.
- Produces: recoverable phases `upload_proof` and `update_payment_status` bound to the already-created job ID.

- [ ] **Step 1: Write a failing pre-submit validation test**

Select `Paid` without a file, submit otherwise valid data, and assert:

```ts
expect(await screen.findByRole("alert")).toHaveTextContent(
  "Attach the payment proof before marking this order as paid.",
);
expect(fetchMock).not.toHaveBeenCalled();
```

Repeat for `Processing`. Verify `Awaiting payment` still creates without a file.

- [ ] **Step 2: Write a failing ordered-request test**

Provide a valid JPEG proof and mock four responses:

1. POST create returns `{ job: { id, jobNumber, updatedAt } }`.
2. POST `/files` returns `{ result: "created" }`.
3. PATCH `/${jobId}` returns `{ result: "updated" }`.

Assert the create JSON uses `manualPaymentStatus: "awaiting_payment"`, upload FormData contains `kind=payment_proof`, and PATCH contains:

```ts
{
  expectedUpdatedAt,
  idempotencyKey: expect.any(String),
  finance: {
    manualPaymentStatus: "paid",
    amountPayableCents: 23050,
    amountPaidCents: 23050,
    artistFeeCents: 0,
    materialCostCents: 0,
  },
}
```

Assert `router.push` occurs only after the PATCH succeeds.

- [ ] **Step 3: Implement local file checks and stable submission identifiers**

Before create, validate:

```ts
const requiresProof = finalPaymentStatus === "processing" || finalPaymentStatus === "paid";
const paymentProof = form.get("paymentProof");
const selectedProof = paymentProof instanceof File && paymentProof.size > 0
  ? paymentProof
  : null;
if (requiresProof && !selectedProof) {
  setPaymentProofError(`Attach the payment proof before marking this order as ${finalPaymentStatus}.`);
  setPending(false);
  return;
}
if (selectedProof && selectedProof.size > 25 * 1024 * 1024) {
  setPaymentProofError("Payment proof must be 25 MB or smaller.");
  setPending(false);
  return;
}
```

Create one manual-job idempotency key, one upload idempotency key and one status-update idempotency key per submission and keep them in recovery state after the job exists.

- [ ] **Step 4: Implement the three-step request sequence**

Use the existing `endpoint` for all three operations:

```ts
const createBody = {
  ...body,
  manualPaymentStatus: requiresProof ? "awaiting_payment" : finalPaymentStatus,
};

const uploadBody = new FormData();
uploadBody.set("kind", "payment_proof");
uploadBody.set("idempotencyKey", uploadIdempotencyKey);
uploadBody.set("file", selectedProof);
await fetch(`${endpoint}/${job.id}/files`, { method: "POST", body: uploadBody });

await fetch(`${endpoint}/${job.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    expectedUpdatedAt: job.updatedAt,
    idempotencyKey: statusIdempotencyKey,
    finance: desiredFinance,
  }),
});
```

Upload any selected proof, even when the selected status remains `Awaiting payment`. Only run PATCH when create used the provisional status.

- [ ] **Step 5: Write failing upload- and update-failure recovery tests**

- Upload failure: assert the order is created once, status PATCH is not called, the feedback names the created job, and clicking `Retry payment proof` retries only the upload using the same job ID/idempotency key.
- Status failure after successful upload: assert clicking `Retry payment status` calls only PATCH and does not recreate or re-upload.
- In both cases, `router.push` must remain uncalled until recovery succeeds.

- [ ] **Step 6: Implement recovery state and retry buttons**

Use a component-only state shape:

```ts
type PaymentRecovery = Readonly<{
  jobId: string;
  jobNumber: string;
  updatedAt: string;
  proof: File;
  uploadIdempotencyKey: string;
  statusIdempotencyKey: string;
  desiredFinance: Readonly<{
    manualPaymentStatus: string;
    amountPayableCents: number;
    amountPaidCents: number;
    artistFeeCents: number;
    materialCostCents: number;
  }>;
  phase: "upload_proof" | "update_payment_status";
}>;
```

Keep this state only in memory. Retry the current phase against the saved job and use the same identifiers. Clear it only after success or component unmount.

- [ ] **Step 7: Run the complete form test**

Run: `npm test -- src/components/admin/production-job-form.test.tsx`

Expected: PASS for validation, ordering, upload recovery, status recovery and existing manual-order tests.

- [ ] **Step 8: Commit the sequenced workflow**

```bash
git add src/components/admin/production-job-form.tsx src/components/admin/production-job-form.test.tsx
git commit -m "feat: sequence manual payment proof confirmation"
```

---

### Task 6: Allow PDF payment proofs on saved orders and run regression verification

**Files:**
- Modify: `src/components/admin/production-files-panel.tsx`
- Test: `src/components/admin/production-files-panel.test.tsx`

**Interfaces:**
- Consumes: route/service PDF support from Task 2.
- Produces: saved-order upload input switches its accept list according to selected file purpose.

- [ ] **Step 1: Write a failing accept-filter test**

Render with `canManageFinance` and `canUploadFiles`, select `Payment proof`, then assert the file input accept value includes `application/pdf`. Select `Design draft` and assert it returns to the current image-only list.

- [ ] **Step 2: Run the panel test and verify the payment-proof accept list fails**

Run: `npm test -- src/components/admin/production-files-panel.test.tsx`

Expected: FAIL because the input is always image-only.

- [ ] **Step 3: Track the selected purpose and switch the label/accept list**

Add `selectedKind` state initialized to `design_draft`. Update it from the purpose select. Use:

```tsx
const acceptsPdf = selectedKind === "payment_proof";
const accept = acceptsPdf
  ? "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
  : "image/jpeg,image/png,image/webp,image/heic,image/heif";
```

Label the control `Payment proof file` for payment proof and `Image file` otherwise. Reset `selectedKind` to `design_draft` after a successful upload along with `form.reset()`.

- [ ] **Step 4: Run all focused payment-proof tests**

Run:

```bash
npm test -- \
  src/server/uploads/local-private-upload-store.test.ts \
  src/server/uploads/private-upload-store.test.ts \
  src/server/production/production-proof-service.test.ts \
  'src/app/api/admin/jobs/[jobId]/files/route.test.ts' \
  'src/app/api/forms/jobs/[jobId]/files/route.test.ts' \
  src/server/production/production-job-service.test.ts \
  src/components/admin/production-job-form.test.tsx \
  src/components/admin/production-files-panel.test.tsx \
  src/components/forms/forms-order-entry-drawer.test.tsx \
  src/components/forms/forms-workbench.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run static and production checks**

Run:

```bash
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Run local browser verification at the required site**

At `http://192.168.4.199:3000/order-system?entry=new`, verify:

- Desktop drawer: payment-proof field appears for the authorised account; Paid with no file is blocked beside the field.
- Image proof: submit completes, detail opens, proof is listed, and status is Paid only after upload.
- PDF proof: submit completes and the finance-authorised saved-order detail can download the same private PDF.
- Simulated upload failure: the created order remains Awaiting payment and retry does not create a second order.
- 390px viewport: control is usable, no horizontal overflow, error is adjacent, and selected file triggers the drawer's unsaved-close warning.
- A non-finance or non-upload role does not see the control and receives 403 if attempting the API directly.

- [ ] **Step 7: Commit saved-order support**

```bash
git add src/components/admin/production-files-panel.tsx src/components/admin/production-files-panel.test.tsx
git commit -m "feat: support PDF payment proofs on saved orders"
```

## Completion Criteria

- Every focused test, TypeScript, ESLint and production build passes from fresh command output.
- Manual Order Entry accepts one image/PDF payment proof and keeps extra attachments on the saved-order detail.
- New Processing/Paid manual orders cannot reach that status before the proof upload succeeds.
- Upload/status failure recovery never creates a duplicate manual order.
- Customer and checkout uploads still reject PDF by default.
- No production deployment is performed until separately requested or confirmed after verification.
