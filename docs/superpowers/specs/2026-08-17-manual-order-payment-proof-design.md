# Manual Order Payment Proof Design

## Goal

Restore payment-proof attachment to the manual `Order entry` workflow without creating a second attachment system. Staff must be able to attach the customer's payment proof while entering the order, and the selected paid/processing status must not be saved before that proof is stored successfully.

## Scope

- Add one `Payment proof` file input to the existing Payment section of `ProductionJobForm` when the staff member has finance and file-upload permission.
- Accept JPG, PNG, WebP, HEIC, HEIF and PDF files up to 25 MB.
- Store the attachment as the existing private `payment_proof` production-file kind.
- Keep the existing saved-order Files panel as the place to add further payment-proof files later.
- Apply the same behaviour to the full `/order-system/new` page and the Order Entry drawer because both reuse `ProductionJobForm`.

## Payment-state rule

- `Awaiting payment`, `Failed`, `Cancelled` and `Refunded` may be saved without a newly selected proof.
- Selecting `Processing` or `Paid` during manual entry requires a payment-proof file.
- The client validates the missing file before creating the job and places the error beside the file input.
- A manual order that is intended to become `Processing` or `Paid` is first created as `Awaiting payment`.
- After creation, the selected proof is uploaded as `payment_proof`.
- Only after the upload succeeds does the client update the manual order to the selected final payment status.
- This order of operations ensures an upload failure cannot leave a newly created manual order marked as paid without its proof.

## Submission flow

1. The user completes Order Entry and selects an optional payment-proof file.
2. The form validates the chosen file type and size. `Processing` and `Paid` also validate that a proof was selected.
3. The form creates the manual job through the existing JSON endpoint. When a proof must precede the selected status, the create payload uses `Awaiting payment` while retaining the other entered finance values.
4. The form uploads the file to the existing private job-files endpoint with kind `payment_proof` and a stable upload idempotency key.
5. If the selected final status differs from `Awaiting payment`, the form reads the current saved job version and sends the existing finance update with the selected final status.
6. After all required steps succeed, the form opens the saved job detail.

The original manual-job idempotency key, created job ID and upload idempotency key remain stable for the duration of this submission. Retrying an upload after the job has been created must target that job instead of creating another order.

## Failure handling

- A validation failure creates no order and no file.
- If order creation fails, no upload is attempted.
- If proof upload fails, the created order remains `Awaiting payment`. The form shows that the order was created, identifies it by its generated order number, and provides a retry action that uploads to that same order.
- If the final payment-status update fails after a successful upload, the proof remains safely attached and the order remains `Awaiting payment`; retry updates only the status.
- Closing a drawer with a selected file counts as unsaved work and continues to use the existing close-warning behaviour.
- File contents, original filenames and customer details are not written to logs, analytics, localStorage or sessionStorage.

## File validation and storage

- Extend the private upload store to validate PDF MIME type and the `%PDF-` file signature in addition to the current image signatures.
- Extend the production-file validation so PDF is allowed only when the file kind is `payment_proof`; customer photos, design drafts and print files keep their existing image-only rule.
- Continue using private storage permissions, opaque storage keys and authenticated download routes.
- A payment proof remains finance-sensitive: upload, listing and download require the existing finance permissions in addition to the relevant file permission.
- No public URL is generated for the attachment.

## UI

- Replace the current text hint, `Payment proof can be attached from the order record after saving.`, with a labelled file control in the Payment section.
- Show accepted formats and the 25 MB limit below the control.
- Keep one file selector in initial Order Entry. Additional proofs can be attached from the saved order detail.
- Show upload and status-update progress without navigating away early.
- Put validation and upload errors next to the payment-proof field and announce submission feedback through the existing live feedback region.
- On mobile, use the existing full-width form-control styling and a minimum 44px touch target; do not introduce a separate modal.

## Permissions

- Staff without `update_finance` cannot see or submit the payment-proof field.
- The Order Entry surface must also pass the existing `upload_files` capability into `ProductionJobForm`; users lacking it do not receive a non-functional upload control.
- Existing API checks remain authoritative. Client-side visibility is not treated as access control.

## Verification

- Component test: finance/upload-authorised staff see the control; unauthorised staff do not.
- Component test: `Processing` or `Paid` without a proof is rejected before order creation.
- Component test: create uses `Awaiting payment`, then uploads the proof, then applies the selected final status in that exact order.
- Component test: upload failure keeps the created job ID, does not send the final status and does not create a duplicate order on retry.
- Component test: successful upload followed by status-update failure retries only the update.
- Route/service tests: payment-proof JPG/PNG/HEIC and PDF validation; disguised or oversized files are rejected.
- Route/service tests: PDF is rejected for non-payment file kinds and payment-proof access still requires finance permission.
- Regression tests: manual order creation without a proof remains valid for non-paid statuses; saved-order file uploads continue to work.
- Run focused Vitest tests, TypeScript, ESLint and the production build.

## Out of scope

- No change to Stripe, Afterpay, web checkout, customer uploads, prices, GST, invoices, order numbering or completed online orders.
- No public customer upload link for payment proofs.
- No change to the separate five-day customer-original cleanup design.
- No redesign of the complete Order Entry form or saved-order detail page.
