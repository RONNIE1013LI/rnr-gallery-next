# Redis website chat and unified inbox

The owner authorized moving ordinary website chat to the existing Meta Redis service, fixing both channels' backend data chain, testing, and normal Production deployment. Existing historical Neon data remains untouched. Proposed new website transcript retention is 30 days; existing seven-day public session expiry remains unchanged.

## Outcome

Session bootstrap, message ingestion, shared reasoning, reply publication and public updates must not query Neon. Both channels must appear in the authenticated inbox, refresh correctly, expose actual timeline and support existing human intervention. Order/payment/authentication business operations remain outside the ordinary chat path.

## Architecture

Use a dedicated Redis website repository implementing the existing small public-handler interfaces. Keep trusted-origin, bounded input, opaque session cookie, short-lived message permit, authenticated identity comparison, trusted-network rate limits, encrypted public cursors and validated publication. Store transcript payloads encrypted, with hashed keys and atomic compare-and-set operations. No generic replacement of the legacy repository or schema migrations.

Use the shared reasoning brain directly rather than the legacy engine, avoiding pricing/case-memory/attempt/outbox Neon dependencies. Product context comes from the versioned local authoritative artifact. Successful publication is atomic with lease ownership, latest-customer-turn and human-takeover checks. Provider failure opens a recoverable human-review record; a draft is never a published reply. Redis failure returns a truthful retryable error, never silently falls back to Neon.

Meta gains an encrypted locator/activity index before AI eligibility checks. Actual Graph conversation content and known successful delivery evidence supply the timeline; a generated draft is never represented as sent. Backend uses a unified facade for initial render, refresh, timeline and takeover, preserving legacy historical reads on explicit admin access. Missing historical shared Meta locators may be recovered by bounded read-only Graph discovery; never replay messages.

## Authentication dependency

Current Better Auth uses opaque signed tokens backed by Neon. Do not infer user ID from the token or downgrade authenticated visitors to anonymous. A Redis-backed trusted identity path must retain expiry, revocation and login/logout isolation. Any required Production authentication configuration change is a separate approval gate under AGENTS.md, even though code preparation and tests are authorized. Until that path is proven, zero-Neon authenticated chat and release remain unproven.

## Verification and release

Test atomic duplicate/concurrent ingestion, existing five rate limits, session/identity/cursor isolation, late AI vs human replies, stale leases, review/manual replies, record expiry, Redis outage and recovery. Exercise public route dependencies with a database trap. Test unified inbox refresh/timeline/sent status for both channels, and preserved historical paths. Run relevant lint/typecheck, full isolated release tests, build and independent review before normal main release. Verify READY Production source/aliases and perform bounded postrelease chat/inbox checks before delivery. No new paid service, new environment values, migration or historical data write is implicit.
