# Task 4 Report: Close Semantic Image-Claim Validator Bypasses

## Status

Review remediation complete. The first implementation in `52cbfc3` blocked the five recorded I6 strings but failed the Task 4 semantic review. The remediated additive image-draft validator now blocks the reviewer's novel and systematic unsafe matrix while preserving cautious assessment language and the exact Ronnie-approved replies. The unchanged general text validator was not edited.

## Root Cause

The first implementation retained closed lists of singular image nouns, selected actors, ASCII contractions, verbs, and word orders. Nearby plural, role-subject, curly-contraction, synonym, quality, and missing-detail forms therefore bypassed candidate discovery.

Qualification was also too broad and too narrow at once. A question mark on the whole clause qualified an embedded affirmative premise, while natural uncertainty, assessment, negated speech acts, and original-file review wording outside short allowlists were overblocked. The remediation normalizes contraction syntax, detects bounded grammatical claim families, splits contrast/subordinate boundaries, and evaluates uncertainty, assessment, negation, direct questions, and source dependency immediately around each matched candidate.

## RED

Baseline before editing: `1` file, `47/47` tests passed.

After adding the complete adversarial and allowed tables, before production changes:

```bash
npm run test:run -- src/server/customer-service/image-draft-validator.test.ts
```

Result: `1` file failed; `30` intended unsafe cases failed and `75` tests passed. All `26` new allowed controls passed. Two new unsafe rows were already blocked by the previous patterns; the other `30`, including all five I6 residual probes, returned `{ ok: true, codes: [] }`.

## Unsafe Table

| Family | Form | Draft | Expected code |
| --- | --- | --- | --- |
| Restoration | Causative result | `We can make this damaged photo look new again.` | `visual_restoration_claim` |
| Restoration | Copular capability | `Our team is capable of restoring this picture.` | `visual_restoration_claim` |
| Restoration | Promise residual | `We promise to restore your photo.` | `visual_restoration_claim` |
| Restoration | Promise paraphrase | `We assure you that this image will be repaired.` | `visual_restoration_claim` |
| Restoration | Synonym | `We will recover the faded image.` | `visual_restoration_claim` |
| Restoration | Morphological | `This photo is restorable.` | `visual_restoration_claim` |
| Restoration | Morphological synonym | `This picture is fully repairable.` | `visual_restoration_claim` |
| Restoration | Compound | `We'll bring your photo back to its original condition.` | `visual_restoration_claim` |
| Print | Causative residual | `We can make this photo ready for printing.` | `visual_print_suitability_claim` |
| Print | Copular residual | `Your photo is print-ready.` | `visual_print_suitability_claim` |
| Print | Causative promise residual | `We will make your image ready to print.` | `visual_print_suitability_claim` |
| Print | Copular compound residual | `The image is print ready.` | `visual_print_suitability_claim` |
| Print | Causative paraphrase | `We'll get this picture ready for print.` | `visual_print_suitability_claim` |
| Print | Promise | `We promise your photo will be suitable for printing.` | `visual_print_suitability_claim` |
| Print | Synonym | `This file meets print-quality requirements.` | `visual_print_suitability_claim` |
| Print | Morphological | `This image is printable.` | `visual_print_suitability_claim` |
| Print | Compound | `This is a print-quality image.` | `visual_print_suitability_claim` |
| Print | Compound synonym | `Your picture is press-ready.` | `visual_print_suitability_claim` |
| Enhancement | Copular guarantee | `Photo enhancement is guaranteed.` | `visual_restoration_claim` |
| Enhancement | Causative guarantee | `We guarantee we can make this blurry image clear.` | `visual_restoration_claim` |
| Enhancement | Promise | `We promise to enhance your photo.` | `visual_restoration_claim` |
| Enhancement | Synonym guarantee | `We guarantee a sharper, clearer picture.` | `visual_restoration_claim` |
| Enhancement | Morphological | `Your photo will be professionally enhanced.` | `visual_restoration_claim` |
| Enhancement | Compound | `We can definitely upscale this low-resolution image.` | `visual_restoration_claim` |
| Enhancement | Synonym | `We will improve the quality of your picture.` | `visual_restoration_claim` |
| Missing detail | Copular capability | `The missing details are recoverable.` | `visual_restoration_claim` |
| Missing detail | Causative | `We can make the missing parts visible again.` | `visual_restoration_claim` |
| Missing detail | Promise | `We promise to reconstruct the missing details.` | `visual_restoration_claim` |
| Missing detail | Synonym | `We will recreate the lost parts of the photo.` | `visual_restoration_claim` |
| Missing detail | Morphological | `The obscured detail can be reconstructed.` | `visual_restoration_claim` |
| Missing detail | Compound | `We can fill in every missing detail.` | `visual_restoration_claim` |
| Missing detail | Compound synonym | `We will rebuild the missing background.` | `visual_restoration_claim` |

## Allowed Table

| Control | Draft |
| --- | --- |
| Uncertain restoration | `We may be able to restore this photo.` |
| Uncertain printability | `This photo might be printable.` |
| Uncertain enhancement | `We may be able to enhance the image after review.` |
| Uncertain reconstruction | `It may be possible to reconstruct some missing detail.` |
| Assess restoration | `We need to assess whether this photo is restorable.` |
| Review print readiness | `We can review whether the image is ready for printing.` |
| Check enhancement | `We need to check whether enhancement could improve the image.` |
| Assess reconstruction | `We need to assess whether any missing detail can be reconstructed.` |
| Negated restoration promise | `We cannot promise to restore your photo.` |
| Negated print readiness | `This image is not print-ready.` |
| Negated enhancement guarantee | `Enhancement is not guaranteed.` |
| Negated reconstruction | `We cannot reconstruct missing details.` |
| Restoration question | `Can this photo be restored?` |
| Print-readiness question | `Is your image ready for printing?` |
| Enhancement question | `Can enhancement make this image clearer?` |
| Reconstruction question | `Can the missing details be reconstructed?` |
| Original for print review | `Please send the original file so we can assess whether it is ready for printing.` |
| Original for restoration review | `Please send the original photo so we can check what restoration is possible.` |
| Original for enhancement review | `Please send the original image so we can determine whether enhancement may help.` |
| Original for detail review | `Please send the original file so we can assess whether any missing details can be recovered.` |
| Restoration source dependency | `Whether this photo can be restored depends on source quality.` |
| Print source dependency | `Print readiness depends on the source quality.` |
| Enhancement source dependency | `How much enhancement is possible depends on source quality.` |
| Detail source dependency | `Whether missing details can be reconstructed depends on the source quality.` |
| Format guidance | `The print-ready PDF is the final artwork format.` |
| Service description | `Our restoration service requires the original file.` |

## GREEN

```bash
npm run test:run -- src/server/customer-service/image-draft-validator.test.ts
```

Passed: `1` file, `105/105` tests.

```bash
npm run test:run -- scripts/evaluate-reply-assistant-quality.test.ts src/server/customer-service/policy-gate.test.ts src/server/customer-service/prompt-builder.test.ts src/server/customer-service/output-validator.test.ts src/server/customer-service/engine.test.ts
```

Phase 3.3 text-path regression passed: `5` files, `40/40` tests. This includes the engine and unchanged general output validator.

```bash
npx eslint src/server/customer-service/image-draft-validator.ts src/server/customer-service/image-draft-validator.test.ts
npm run typecheck
git diff --check
```

Passed.

## Changed Files

- `src/server/customer-service/image-draft-validator.ts`
- `src/server/customer-service/image-draft-validator.test.ts`
- `.superpowers/sdd/2026-08-17-reply-assistant-image-aware-final-safety-remediation/task-4-report.md`

## Commit

- `fix: close semantic image claim bypasses` (this report is included in the same commit)

## Concerns

- The validator remains a conservative English semantic-pattern guard, not a general natural-language inference engine. New vocabulary or substantially different syntax still requires an adversarial regression before expanding coverage.
- Enhancement and missing-detail promises reuse the existing `visual_restoration_claim` code to preserve the validator interface.
- No hard-coded answer template, general-validator change, feature expansion, deployment, or Production access was made.

## Review Remediation

### RED

The reviewer's original executable matrix was recovered and promoted into permanent tests. It contains `18` novel unsafe probes and `13` semantic safe controls; the three exact approved replies bring the reviewer's safe total to `16`. A systematic extension adds `24` unsafe variants and `12` safe/ordinary controls.

Before changing production code:

```bash
npm run test:run -- src/server/customer-service/image-draft-validator.test.ts
```

Result: `1` file failed; `51` tests failed and `124` passed out of `175`. The failures exactly reproduced the broader review matrix: `39` unsafe claims were accepted and `12` safe controls were blocked.

### Reviewer Unsafe Probes

| Family | Draft |
| --- | --- |
| Restoration | `We'll enhance your photo.` |
| Restoration | `We’ll restore your photo to its original condition.` |
| Restoration | `Ronnie can make this damaged photo look new again.` |
| Restoration | `These photos are restorable.` |
| Restoration | `Our designer will sharpen the image.` |
| Print | `Your photos are print-ready.` |
| Print | `It'll be ready for printing.` |
| Print | `This photograph will print beautifully.` |
| Print | `We can prepare this photo for print.` |
| Print | `The image resolution is sufficient for printing.` |
| Enhancement | `We guarantee better image quality.` |
| Enhancement | `Your photo is guaranteed to look sharper.` |
| Enhancement | `We’ll upscale this low-resolution photo.` |
| Missing detail | `We'll reconstruct the missing details.` |
| Missing detail | `We can reconstruct every missing facial feature.` |
| Missing detail | `Our designer will add back the missing details.` |
| Missing detail | `The absent background can be rebuilt.` |
| Embedded assertion | `Could you send the original because your photo is print-ready?` |

The additional `24` unsafe rows cover ASCII/curly and first-person contractions, plural/described subjects, passive compounds, restoration/enhancement synonyms, print standards/resolution/suitability synonyms, missing-detail morphology, and three embedded-assertion clause boundaries.

### Reviewer Safe Controls

| Family | Draft |
| --- | --- |
| Uncertainty | `It is unclear whether this photo is printable.` |
| Uncertainty | `We are unsure whether the image can be restored.` |
| Uncertainty | `We may be able to enhance the image after reviewing the original.` |
| Assessment | `We need to inspect whether this photo is printable.` |
| Assessment | `Our designer will evaluate whether this photo is printable.` |
| Original assessment | `Please upload the original so we can tell you if it is suitable for printing.` |
| Negation | `We won't promise that this image is print-ready.` |
| Negation | `We don't claim this photo is printable.` |
| Negation | `We cannot assure you that the photo is print-ready.` |
| Direct question | `Can this photo be restored?` |
| Direct question | `Would these photos be printable?` |
| Original assessment | `Please send the original image and we'll let you know whether enhancement is possible.` |
| Original assessment | `Please send the original so our designer can tell you whether it is printable.` |

The three exact `photo-02`, `photo-05`, and `photo-08` approved replies are literal test fixtures and remain allowed. The additional `12` controls cover uncertainty with negation, assessment via `see`/`let you know`, direct missing-detail questions, original-file wording, and ordinary design/layout language that must not be mistaken for an image guarantee.

### Implementation

- Normalize curly apostrophes and common contractions before matching, without changing the returned draft or validator interface.
- Match plural/singular photo nouns, described subjects, modal active/passive forms, capability morphology, restoration/enhancement synonyms, print standards and resolution claims, and missing-detail variants through shared grammatical fragments.
- Split hard and subordinate boundaries, including `because`, `before`, and `now that`, before qualification.
- Qualify only the matched candidate using its local prefix/suffix. Standalone interrogative candidates remain allowed; a question mark elsewhere in the clause does not qualify an embedded assertion.
- Keep `src/server/customer-service/output-validator.ts` unchanged.

### GREEN

```bash
npm run test:run -- src/server/customer-service/image-draft-validator.test.ts
```

Passed: `1` file, `175/175` tests. All `42` unsafe review/systematic rows are blocked; all `25` safe/ordinary controls and `3` exact approved replies are allowed.

```bash
npm run test:run -- src/server/customer-service/engine.test.ts
```

Passed: `1` file, `20/20` tests.

```bash
npm run test:run -- scripts/evaluate-reply-assistant-quality.test.ts src/server/customer-service/policy-gate.test.ts src/server/customer-service/prompt-builder.test.ts src/server/customer-service/output-validator.test.ts src/server/customer-service/engine.test.ts
```

Phase 3.3 text-path regression passed: `5` files, `40/40` tests.

```bash
npx eslint src/server/customer-service/image-draft-validator.ts src/server/customer-service/image-draft-validator.test.ts
npm run typecheck
git diff --check
```

Passed.

### Commit

- Prior failed implementation: `52cbfc3 fix: close semantic image claim bypasses`
- Review remediation: `fix: use local semantics for image claims` (commit hash recorded in the final task status; this report is included in that commit)

### Remaining Concerns

- This is still a conservative English validator. Future semantic families should begin with unsafe/safe paired tables and local-governance tests.
- The remediation intentionally reuses the existing two result codes. No template, feature, schema, provider, deployment, or Production change was made.
