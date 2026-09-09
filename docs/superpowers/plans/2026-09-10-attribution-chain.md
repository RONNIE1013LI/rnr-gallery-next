# Attribution chain implementation plan

Goal: distinguish acquisition from the converting session without inventing historical ad attribution.

Architecture: reuse the existing order attribution JSON, visitor/session linkage and first/last-non-direct conversion fields. Preserve consent, identity isolation, payment observers and stable Purchase IDs. No schema or formal migration changes.

- [x] Read-only evidence: the audited order, session/conversion and cookie-presence/timestamps verified in the existing Neon console. Individual Meta event ID and delivery response remain unavailable; matching totals are not proof.
- [x] Inspect live four-domain redirects with synthetic query parameters, without executing tracking JavaScript. All retain UTM/fbclid; canonical is rnrgallery.com.
- [x] Inspect Meta visible campaign result and attribution window; Purchase 1 is reported, individual matching remains unverified.
- [x] Add failing tests for durable consented touch history, direct returns, organic returns, isolation, Meta-cookie fallback and backend acquisition/session display.
- [x] Persist bounded first/last/last-non-direct touches for 90 days in identity-scoped local storage, preserve session campaign compatibility, hand off guest attribution on login, clear signed-out identity.
- [x] Validate and consent-filter history at order creation into existing JSON. Reuse the original checkout/payment path unchanged.
- [x] Keep valid _fbc priority; build missing fbc from a validated fbclid and captured click time; retain _fbp only with advertising consent.
- [x] Display acquisition and last session separately using existing conversion/session records, with explicit unknown where records are missing.
- [x] Run focused failing/passing tests, relevant integrations and isolated release gate; read-only review. Final gate: 665 files / 6249 tests passed, 17 skipped, cleanup PASS; typecheck/build PASS; lint 0 errors. Normal main release follows.
- [x] Recheck actual order: the audited order retains Direct; no historical write because individual Meta event linkage is unavailable. Full evidence report kept outside Git to avoid publishing order data.
