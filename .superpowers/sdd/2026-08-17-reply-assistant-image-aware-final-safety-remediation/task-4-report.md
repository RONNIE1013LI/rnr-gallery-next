# Task 4 Report: Close Semantic Image-Claim Validator Bypasses

## Status

Complete. The additive image-draft validator now rejects definitive restoration, print-readiness, enhancement, and missing-detail reconstruction claims across the requested semantic forms while retaining the existing result codes and qualification behavior. The unchanged general text validator was not edited.

## Root Cause

`claimIsQualified` already preserved questions, uncertainty, explicit negation, assessment context, and source-dependent wording after a candidate was found. Candidate discovery was the gap: it used a short restoration verb list and fixed `print-ready`/`suitable for print` word orders. Copular and causative print-readiness forms, promise verbs, enhancement/reconstruction synonyms, morphological forms, and compound result phrases never reached the qualification gate and were accepted as safe.

The fix expands only the image validator's bounded semantic candidate families. It reuses the existing qualification gate, adds `what`/`how` assessment context, and treats an explicit dependency on source quality as qualified.

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
