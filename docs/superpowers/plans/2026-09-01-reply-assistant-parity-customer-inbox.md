# Reply Assistant Parity and Customer Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Facebook and Website the same deterministic business resolution, render exactly one Admin Inbox box per authoritative customer identity across technical conversations, and keep the newest Website reply visible during active chat.

**Architecture:** Resolve a shared immutable `ConversationState` before policy/pricing/provider work, adapt Reply Assistant pricing to the canonical market quote engine, and preserve Website’s strict schema/allowlisted renderer. Add a hash-only conversation-identity link as the authoritative Inbox grouping source, aggregate server DTOs by opaque `inboxId`, and key live React updates by that ID. Implement transcript follow-latest as a small DOM controller around the existing chat scroll container.

**Tech Stack:** TypeScript, React 19, Next.js, Vitest, Testing Library, Drizzle ORM, PostgreSQL, Vercel Git integration.

**Spec:** `docs/superpowers/specs/2026-09-01-reply-assistant-parity-customer-inbox-design.md`

## Global Constraints

- `SAME IDENTIFIABLE CUSTOMER = EXACTLY ONE INBOX BOX`; `conversationId`, `sessionId`, message ID, product topic, and Human Review generation never create another visible box when the authoritative identity matches.
- Identity priority is Facebook PSID; Website authenticated customer; Website consented signed stable visitor; exact technical conversation fallback.
- Never merge using IP, network bucket, fingerprint, text, product, intent, name, timing, or fuzzy similarity.
- Preserve Guest/User A/Guest/User B isolation and rotate Website technical chat scope on exact identity changes.
- Do not change official prices, business policies, model selection, payment configuration, authentication configuration, analytics consent rules, DNS, or domains.
- Website keeps strict JSON schema output and the allowlisted renderer; no public free-text model output.
- No Production data deletion or historical cleanup is authorized.
- The migration freeze forbids generating, editing, renaming, renumbering, or executing a formal migration file now.
- The identity-link migration remains a hard blocker. Until it is completed and verified, every report says `PRODUCTION READY: NO`.
- Production database migration and Production release require their own governance gates. Normal release remains verified worktree -> `origin/main` -> Vercel automatic Production.

---

## Execution Groups

The plan is executed inline because this task is not authorized for delegated agent work.

- **Group 1 — executable now:** Tasks 1-6 (shared state, pricing, parity, scroll).
- **Group 2 — executable now without schema writes:** Tasks 7-8 (identity contracts and pure Inbox projection).
- **Group 3 — blocked by migration freeze:** Tasks 9-11 (formal schema/migration, repository integration, cross-conversation review integration).
- **Group 4 — after Group 3:** Tasks 12-14 (Admin UI wiring, full verification, Production release/guard).

Do not call a blocked task complete. Stop at its gate and preserve `PRODUCTION READY: NO`.

---

### Task 1: Shared Deterministic Conversation State

**Files:**

- Create: `src/server/customer-service/conversation/conversation-state.ts`
- Create: `src/server/customer-service/conversation/conversation-state.test.ts`
- Modify: `src/server/customer-service/conversation/contextual-intent.ts`
- Modify: `src/server/customer-service/conversation/contextual-intent.test.ts`

**Interfaces:**

- Consumes: `CustomerServiceIntent`, `ConversationContextItem`, `SafeProductContext`, `ProductRegistryDocument`.
- Produces: `resolveConversationState(input): ConversationState` and exported immutable state/value types.
- Later tasks consume `ConversationState` directly; they do not re-parse history independently.

- [ ] **Step 1: Write the failing multi-turn state tests**

```ts
import { describe, expect, it } from "vitest";
import { defaultProductRegistry, parseProductRegistry } from "@/domain/catalogue/product-registry";
import { resolveConversationState } from "./conversation-state";

const registry = parseProductRegistry(defaultProductRegistry);
const at = "2026-09-01T07:00:00.000Z";
const customer = (text: string) => ({ role: "customer" as const, text, receivedAt: at });
const staff = (text: string) => ({ role: "staff" as const, text, receivedAt: at });

describe("resolveConversationState", () => {
  it("preserves Roll-up price intent and product when the customer answers New Zealand", () => {
    const state = resolveConversationState({
      currentText: "New Zealand",
      history: [
        customer("How much for roll up banner?"),
        staff("Is this for New Zealand or Australia?"),
      ],
      productContext: null,
      registry,
    });
    expect(state.intent.value).toBe("quote_information_collection");
    expect(state.market?.value).toBe("NZ");
    expect(state.product?.productKey).toBe("roll-up-banner");
    expect(state.asksCataloguePrice).toBe(true);
    expect(state.missingFields).toEqual([]);
  });

  it("preserves A2 Canvas price context and records three people", () => {
    const state = resolveConversationState({
      currentText: "A2 3 people",
      history: [
        customer("How much for A2 canvas?"),
        staff("Which Canvas type would you like?"),
      ],
      productContext: null,
      registry,
    });
    expect(state.intent.value).toBe("quote_information_collection");
    expect(state.size?.value).toBe("a2");
    expect(state.peoplePets?.value).toBe(3);
    expect(state.product).toBeNull();
    expect(state.productCandidates).toEqual([
      "photo-print-canvas",
      "digital-oil-painting-canvas",
      "custom-themed-canvas",
    ]);
    expect(state.missingFields).toEqual(["PRODUCT_TYPE"]);
  });

  it("clears incompatible Canvas slots when the customer switches to Roll-up Banner", () => {
    const state = resolveConversationState({
      currentText: "Actually how much for a roll up banner?",
      history: [customer("A2 digital oil canvas with 3 people in NZ")],
      productContext: null,
      registry,
    });
    expect(state.product?.productKey).toBe("roll-up-banner");
    expect(state.size?.value).toBe("standard");
    expect(state.peoplePets).toBeNull();
  });

  it("never treats a staff statement as a customer fact", () => {
    const state = resolveConversationState({
      currentText: "yes",
      history: [staff("You are in Australia and want an A2 canvas")],
      productContext: null,
      registry,
    });
    expect(state.market).toBeNull();
    expect(state.product).toBeNull();
  });
});
```

- [ ] **Step 2: Run the state tests and verify RED**

Run:

```bash
npm run test:run -- src/server/customer-service/conversation/conversation-state.test.ts
```

Expected: FAIL because `conversation-state.ts` and `resolveConversationState` do not exist.

- [ ] **Step 3: Implement the minimal pure state resolver**

Implement these exact public types and entry point:

```ts
export type ConversationStateSource =
  | "current_message"
  | "customer_history"
  | "server_page_context";

export type ResolvedConversationValue<T> = Readonly<{
  value: T;
  source: ConversationStateSource;
}>;

export type ConversationState = Readonly<{
  intent: ResolvedConversationValue<CustomerServiceIntent>;
  market: ResolvedConversationValue<Market> | null;
  product: Readonly<{ productKey: string; source: ConversationStateSource }> | null;
  productCandidates: readonly string[];
  size: ResolvedConversationValue<string> | null;
  peoplePets: ResolvedConversationValue<number> | null;
  photoCount: ResolvedConversationValue<number> | null;
  requiredDate: ResolvedConversationValue<string> | null;
  deliveryLocation: ResolvedConversationValue<string> | null;
  asksCataloguePrice: boolean;
  missingFields: readonly FollowUpField[];
}>;

export function resolveConversationState(input: Readonly<{
  currentText: string;
  history: readonly ConversationContextItem[];
  productContext: SafeProductContext | null;
  registry: ProductRegistryDocument;
}>): ConversationState;
```

Implementation rules:

1. Parse current customer text first, then earlier customer messages newest-first, then page context.
2. Use staff messages only to recognize an open requested slot.
3. Recognize `New Zealand or Australia` as a market question without requiring the word `country`.
4. Use exact product aliases from active registry products; broad `canvas` and `banner` produce candidate arrays instead of a guessed product.
5. Resolve A0-A4 and configured dimensions to canonical size keys.
6. Parse people/pets and photo counts only from customer messages.
7. A current explicit product overrides prior product-specific size/people/photo state.
8. Derive `missingFields` from price intent and the selected product schema; do not use the global quote checklist.
9. Freeze returned arrays/objects.

- [ ] **Step 4: Replace narrow contextual-intent matching with state-backed intent inheritance**

Keep `resolveContextualIntent` as a compatibility wrapper for current callers, but make its market/product follow-up cases call the same semantic helpers exported from `conversation-state.ts`. Add regressions for the exact generated market question and `A2 3 people`.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npm run test:run -- src/server/customer-service/conversation/conversation-state.test.ts src/server/customer-service/conversation/contextual-intent.test.ts
```

Expected: PASS with no warnings.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/server/customer-service/conversation/conversation-state.ts src/server/customer-service/conversation/conversation-state.test.ts src/server/customer-service/conversation/contextual-intent.ts src/server/customer-service/conversation/contextual-intent.test.ts
git commit -m "fix(reply-assistant): resolve deterministic conversation state"
```

---

### Task 2: Canonical Reply Assistant Quote Adapter

**Files:**

- Modify: `src/server/customer-service/pricing-source.ts`
- Modify: `src/server/customer-service/pricing-source.test.ts`
- Modify: `src/server/customer-service/website/structured-decision.ts`
- Modify: `src/server/customer-service/website/structured-decision.test.ts`

**Interfaces:**

- Consumes: `ConversationState`, Product Registry revision, `quoteMarketConfiguration`.
- Produces: `resolveApprovedPricing({ state, registry, revision }): ApprovedPricingResolution`.
- The verified fact’s `amountInclTaxCents` is the complete canonical configuration total, including applicable people/pets fees.

- [ ] **Step 1: Write failing canonical quote tests**

```ts
it("uses the canonical configuration total for A2 Digital Oil Canvas with three people", () => {
  const state = resolveConversationState({
    currentText: "A2 digital oil painting canvas, 3 people",
    history: [customer("I am in New Zealand. How much is it?")],
    productContext: null,
    registry,
  });
  const result = resolveApprovedPricing({ state, registry, revision: 42 });
  const expected = quoteMarketConfiguration(registry, "NZ", "digital-oil-painting-canvas", {
    sizeKey: "a2",
    peoplePets: 3,
  });
  expect(result).toMatchObject({
    status: "verified",
    sourceRevision: 42,
    facts: [{ amountInclTaxCents: expected.totalInclGstCents }],
  });
});

it("asks only for Canvas subtype when A2 and three people are already known", () => {
  const state = resolveConversationState({
    currentText: "A2 3 people",
    history: [customer("How much for canvas in NZ?")],
    productContext: null,
    registry,
  });
  expect(resolveApprovedPricing({ state, registry, revision: 42 })).toEqual({
    status: "clarification_required",
    missing: ["product"],
    sourceRevision: 42,
  });
});

it("quotes the configured standard Roll-up price from only product and NZ market", () => {
  const state = resolveConversationState({
    currentText: "New Zealand",
    history: [customer("How much for roll up banner?")],
    productContext: null,
    registry,
  });
  expect(resolveApprovedPricing({ state, registry, revision: 42 })).toMatchObject({
    status: "verified",
    market: "NZ",
    facts: [{ productKey: "roll-up-banner", sizeKey: "standard" }],
  });
});
```

- [ ] **Step 2: Run pricing tests and verify RED**

```bash
npm run test:run -- src/server/customer-service/pricing-source.test.ts
```

Expected: FAIL because the current resolver accepts message/history and returns only the base size price.

- [ ] **Step 3: Implement the canonical adapter**

Change the resolver input to:

```ts
export function resolveApprovedPricing(input: Readonly<{
  state: ConversationState;
  registry: ProductRegistryDocument;
  revision: number;
}>): ApprovedPricingResolution;
```

For an exact product/market/size:

```ts
const schema = schemaFromRegistry(input.registry, productKey);
const peoplePets = schema?.peoplePetsMode === "required"
  ? input.state.peoplePets?.value ?? null
  : 0;
if (schema?.peoplePetsMode === "required" && peoplePets === null) {
  return { status: "clarification_required", missing: ["peoplePets"], sourceRevision: input.revision };
}
const quote = quoteMarketConfiguration(input.registry, market, productKey, {
  sizeKey,
  peoplePets,
});
```

Catch only `InvalidPricingInputError` and map it to existing safe unavailable reasons. Let unexpected programming errors surface in tests.

- [ ] **Step 4: Extend the Website renderer proof for a complete quote fact**

Keep the public schema strict. Add optional `peoplePets` to the server-injected proof only, include it in exact-key validation, and render the verified total without copying any fee constants. The model JSON schema still cannot supply the amount or `peoplePets`; the engine injects both after parsing.

- [ ] **Step 5: Run canonical pricing and renderer tests**

```bash
npm run test:run -- src/server/customer-service/pricing-source.test.ts src/server/customer-service/website/structured-decision.test.ts src/domain/pricing/market-quote.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/server/customer-service/pricing-source.ts src/server/customer-service/pricing-source.test.ts src/server/customer-service/website/structured-decision.ts src/server/customer-service/website/structured-decision.test.ts
git commit -m "fix(reply-assistant): use canonical configuration quotes"
```

---

### Task 3: Engine Integration and Progressive Slot Filling

**Files:**

- Modify: `src/server/customer-service/engine.ts`
- Modify: `src/server/customer-service/engine.test.ts`
- Modify: `src/server/customer-service/prompt-builder.ts`
- Modify: `src/server/customer-service/website/structured-decision.ts`
- Modify: `src/server/customer-service/website/ronnie-response-quality.test.ts`

**Interfaces:**

- Consumes: `resolveConversationState`, `resolveApprovedPricing`.
- Produces: one resolved state/gate/knowledge/price context shared by Facebook and Website.
- Website continues through `parseWebsiteDecision` and `renderWebsiteDecision`.

- [ ] **Step 1: Add failing engine regressions for the two Production failures**

Add tests using the existing engine setup and mocked provider:

```ts
it("answers the Roll-up price after the customer answers New Zealand", async () => {
  const current = setup("New Zealand", {
    channel: "website",
    context: [
      customer("How much for roll up banner?"),
      staff("Is this for New Zealand or Australia?"),
    ],
    providerDecision: safePriceDecision(),
  });
  await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "webhook_after" }))
    .resolves.toMatchObject({ status: "draft_ready" });
  expect(current.repository.createGateBlockedAttempt).not.toHaveBeenCalled();
  expect(current.repository.completeProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({
    websiteDecision: expect.objectContaining({
      approved_catalogue_price: expect.objectContaining({ productKey: "roll-up-banner" }),
    }),
  }));
});

it("asks only for Canvas subtype after A2 and three people", async () => {
  const current = setup("A2 3 people", {
    channel: "website",
    context: [
      customer("How much for A2 canvas in NZ?"),
      staff("Which Canvas type would you like?"),
    ],
    providerDecision: askFor(["PRODUCT_TYPE"]),
  });
  await current.engine.generateDraft({ messageId: "message-1", trigger: "webhook_after" });
  expect(current.repository.completeProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({
    websiteDecision: expect.objectContaining({
      missing_fields: ["PRODUCT_TYPE"],
      follow_up_fields: ["PRODUCT_TYPE"],
    }),
  }));
});
```

- [ ] **Step 2: Verify RED**

```bash
npm run test:run -- src/server/customer-service/engine.test.ts
```

Expected: first case is gate-blocked as unresolved; second loses price/product context or asks already-known fields.

- [ ] **Step 3: Resolve state once before the gate**

In `generateDraft`, load the current registry before state resolution when a price/topic may need catalogue aliases. Build one state and pass `state.intent.value` to the gate. Set contextual quote detail from state provenance rather than last-staff regex.

Determine catalogue pricing from `state.asksCataloguePrice`, not only the current text. Call the Task 2 resolver with the state.

- [ ] **Step 4: Make Website follow-up decisions deterministic**

Before provider invocation, convert state/price missing fields to allowlisted Website fields. After provider parsing, the server-owned state remains authoritative for price and follow-up fields. The model may choose only a compatible response type/fact set; it cannot add fields that state says are already known.

Add one renderer question for Canvas subtype that does not repeat A2 or people count:

```text
Which Canvas type would you like: Photo Print, Digital Oil Painting, or Custom Themed?
```

- [ ] **Step 5: Pass equivalent resolved business context to both prompts**

Add `conversationState` and a compact server-resolved rule/quality summary to both prompt builders. Website receives identifiers and allowlisted fact names, never literal private case content or free prose to publish. Facebook retains its richer draft context. Assert that both prompts carry the same intent, product, market, missing fields, knowledge version, and canonical quote revision.

- [ ] **Step 6: Verify GREEN and existing safety**

```bash
npm run test:run -- src/server/customer-service/engine.test.ts src/server/customer-service/website/ronnie-response-quality.test.ts src/server/customer-service/website/security-regression.test.ts
```

Expected: PASS; strict-schema, prompt-injection, amount-integrity, budget, and Human Review tests remain green.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/server/customer-service/engine.ts src/server/customer-service/engine.test.ts src/server/customer-service/prompt-builder.ts src/server/customer-service/website/structured-decision.ts src/server/customer-service/website/ronnie-response-quality.test.ts
git commit -m "fix(reply-assistant): share progressive conversation state"
```

---

### Task 4: Facebook/Website Parity Matrix

**Files:**

- Create: `src/server/customer-service/reply-parity.test.ts`
- Modify: `src/server/customer-service/website/website-evaluation.test.ts`
- Modify: `src/server/customer-service/conversation/conversation-evaluation.test.ts`

**Interfaces:**

- Consumes: real `CustomerServiceEngine` with isolated repositories/providers.
- Produces: a regression matrix asserting state, pricing, missing fields, and handoff parity—not identical prose.

- [ ] **Step 1: Write the table-driven parity cases**

Use these exact cases:

```ts
const cases = [
  ["roll-up follow-up NZ", ["How much for roll up banner?", "New Zealand"]],
  ["roll-up direct NZ", ["How much is a roll up banner in NZ?"]],
  ["A2 Canvas follow-up", ["How much for A2 canvas in NZ?", "A2, 3 people"]],
  ["wall banner AU", ["How much for wall hanging banner?", "Australia"]],
  ["Brisbane shipping", ["Do you ship to Brisbane?"]],
  ["turnaround", ["How long does it take?"]],
] as const;
```

For every case assert both channels have identical:

- resolved intent;
- product candidate/exact product;
- market and size;
- missing fields;
- canonical pricing status/fact;
- policy decision and handoff reason.

Do not require identical wording. Shipping/turnaround cases must follow the
current confirmed policy flags; this task does not change a policy from
`mayAnswerAutomatically=false` to true.

- [ ] **Step 2: Verify RED before the engine integration is accepted**

```bash
npm run test:run -- src/server/customer-service/reply-parity.test.ts
```

Expected: FAIL on current origin/main for multi-turn Website cases.

- [ ] **Step 3: Add only missing deterministic mappings exposed by the matrix**

Do not add channel-specific price or intent branches. Every correction belongs in `ConversationState`, canonical pricing, or shared gate context.

- [ ] **Step 4: Run the evaluation suites**

```bash
npm run test:run -- src/server/customer-service/reply-parity.test.ts src/server/customer-service/website/website-evaluation.test.ts src/server/customer-service/conversation/conversation-evaluation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/server/customer-service/reply-parity.test.ts src/server/customer-service/website/website-evaluation.test.ts src/server/customer-service/conversation/conversation-evaluation.test.ts
git commit -m "test(reply-assistant): lock Facebook Website parity"
```

---

### Task 5: Smart Follow-Latest Controller

**Files:**

- Create: `src/components/customer-chat/follow-latest.ts`
- Create: `src/components/customer-chat/follow-latest.test.ts`
- Modify: `src/components/customer-chat/customer-chat.tsx`
- Modify: `src/components/customer-chat/customer-chat.test.tsx`
- Modify: `src/components/customer-chat/customer-chat.module.css`

**Interfaces:**

- Produces: `isNearBottom(element, threshold)` and `scrollTranscriptToLatest(element, behavior)`.
- `CustomerChat` owns refs/state; helper code contains no React or global window scroll.

- [ ] **Step 1: Write failing helper tests**

```ts
it.each([
  [900, 500, 400, true],
  [900, 500, 360, true],
  [900, 500, 300, false],
])("detects the 48px near-bottom threshold", (scrollHeight, clientHeight, scrollTop, expected) => {
  expect(isNearBottom({ scrollHeight, clientHeight, scrollTop }, 48)).toBe(expected);
});

it("scrolls the transcript rather than the window", () => {
  const scrollTo = vi.fn();
  scrollTranscriptToLatest({ scrollHeight: 900, scrollTo } as never, "auto");
  expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: "auto" });
});
```

- [ ] **Step 2: Verify helper RED**

```bash
npm run test:run -- src/components/customer-chat/follow-latest.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the minimal helpers**

```ts
export const FOLLOW_LATEST_THRESHOLD_PX = 48;

export function isNearBottom(
  element: Pick<HTMLElement, "scrollHeight" | "clientHeight" | "scrollTop">,
  threshold = FOLLOW_LATEST_THRESHOLD_PX,
) {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= threshold;
}

export function scrollTranscriptToLatest(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTo">,
  behavior: ScrollBehavior,
) {
  element.scrollTo({ top: element.scrollHeight, behavior });
}
```

- [ ] **Step 4: Add failing component tests for active follow and history reading**

Cover:

1. opening a populated chat scrolls to latest after catch-up;
2. sending restores follow mode before optimistic customer append;
3. final non-streaming assistant event scrolls to latest when near bottom;
4. manually scrolling more than 48px away prevents forced scroll;
5. a new assistant event then shows `New message`;
6. clicking it scrolls to latest and hides the control;
7. retry and quick action restore follow;
8. reduced motion uses `auto` behavior.

Mock only `requestAnimationFrame`, `ResizeObserver`, and element geometry. Assert calls on the transcript element; assert `window.scrollTo` is never called.

- [ ] **Step 5: Verify component RED**

```bash
npm run test:run -- src/components/customer-chat/customer-chat.test.tsx
```

Expected: the new follow/latest assertions fail against the current component.

- [ ] **Step 6: Wire follow-latest into `CustomerChat`**

Add:

```ts
const transcriptRef = useRef<HTMLDivElement>(null);
const followLatestRef = useRef(true);
const programmaticScrollRef = useRef(false);
const [newMessageAvailable, setNewMessageAvailable] = useState(false);
```

On transcript scroll, update `followLatestRef` unless a programmatic scroll is active. On send/retry/quick action, set follow true before appending. In a layout effect keyed by visible transcript content and typing state, schedule one animation frame. If following, scroll the transcript; otherwise show the new-message control only for new non-customer content.

Observe transcript resize while open. Disconnect and cancel the frame on cleanup. Add a bottom anchor and an accessible `New message` button inside the panel without changing existing dimensions/design tokens.

- [ ] **Step 7: Run component and accessibility regressions**

```bash
npm run test:run -- src/components/customer-chat/follow-latest.test.ts src/components/customer-chat/customer-chat.test.tsx src/app/layout.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/components/customer-chat/follow-latest.ts src/components/customer-chat/follow-latest.test.ts src/components/customer-chat/customer-chat.tsx src/components/customer-chat/customer-chat.test.tsx src/components/customer-chat/customer-chat.module.css
git commit -m "fix(customer-chat): follow the latest assistant reply"
```

---

### Task 6: Non-Schema Regression Checkpoint

**Files:** No source changes unless a failing test identifies a regression.

**Interfaces:** Proves Group 1 is independently healthy before identity work.

- [ ] **Step 1: Run focused customer-service suites**

```bash
npm run test:run -- src/server/customer-service/engine.test.ts src/server/customer-service/pricing-source.test.ts src/server/customer-service/conversation src/server/customer-service/website src/components/customer-chat
```

- [ ] **Step 2: Run typecheck and diff validation**

```bash
npm run typecheck
git diff --check origin/main...HEAD
```

- [ ] **Step 3: Record exact passing/failing counts in the execution log**

Do not mark the checkpoint green if any command was skipped or environment-blocked.

---

### Task 7: Authoritative Identity Contracts Without Database Changes

**Files:**

- Create: `src/server/customer-service/identity/customer-identity.ts`
- Create: `src/server/customer-service/identity/customer-identity.test.ts`

**Interfaces:**

- Produces `CustomerInboxIdentity` and exact Website identity-resolution helpers.
- This task is pure and does not change live session permits, routes, persistence, or schema. Permit binding and route integration remain blocked until Tasks 9-10 can persist and validate the same identity transactionally.

- [ ] **Step 1: Write failing identity-priority tests**

```ts
it("prefers the authenticated customer over a stable visitor", () => {
  expect(resolveWebsiteInboxIdentity({
    authenticatedCustomerId: "customer-a",
    stableVisitorDigest: "a".repeat(64),
    technicalConversationHash: "b".repeat(64),
    secret: sessionSecret,
  })).toMatchObject({ kind: "website_authenticated_customer" });
});

it("uses the stable visitor only when there is no authenticated customer", () => {
  expect(resolveWebsiteInboxIdentity({
    authenticatedCustomerId: null,
    stableVisitorDigest: "a".repeat(64),
    technicalConversationHash: "b".repeat(64),
    secret: sessionSecret,
  })).toEqual({ kind: "website_stable_visitor", keyHash: "a".repeat(64) });
});

it("falls back to the exact technical conversation without fuzzy inputs", () => {
  expect(resolveWebsiteInboxIdentity({
    authenticatedCustomerId: null,
    stableVisitorDigest: null,
    technicalConversationHash: "b".repeat(64),
    secret: sessionSecret,
  })).toEqual({ kind: "website_conversation", keyHash: "b".repeat(64) });
});
```

Also assert HMAC output contains no raw customer ID and that different customers never share a key.

- [ ] **Step 2: Verify identity RED**

```bash
npm run test:run -- src/server/customer-service/identity/customer-identity.test.ts
```

- [ ] **Step 3: Implement exact identity values**

```ts
export type CustomerInboxIdentity = Readonly<{
  kind:
    | "facebook_psid"
    | "website_authenticated_customer"
    | "website_stable_visitor"
    | "website_conversation";
  keyHash: string;
}>;

export function authenticatedWebsiteCustomerHash(customerId: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`website-inbox-customer\0${customerId.trim()}`)
    .digest("hex");
}
```

Validate all incoming hashes as lowercase 64-character hex. The resolver signature has no IP, user-agent, name, message, product, or timestamp parameter.

- [ ] **Step 4: Prove the pure contract cannot accept prohibited evidence**

Add compile-time/runtime contract tests showing the resolver accepts only authenticated customer ID, an already-consented stable visitor digest, an exact technical conversation hash, and the server secret. Assert the public identity object contains only `kind` and `keyHash`; no IP, user-agent, fingerprint, name, message text, product, timestamp, or raw customer ID appears.

- [ ] **Step 5: Run identity/session security tests**

```bash
npm run test:run -- src/server/customer-service/identity/customer-identity.test.ts
```

- [ ] **Step 6: Commit Task 7**

```bash
git add src/server/customer-service/identity/customer-identity.ts src/server/customer-service/identity/customer-identity.test.ts
git commit -m "feat(customer-chat): define authoritative inbox identity"
```

---

### Task 8: Pure Customer Inbox Projection

**Files:**

- Create: `src/server/customer-service/inbox/customer-inbox.ts`
- Create: `src/server/customer-service/inbox/customer-inbox.test.ts`

**Interfaces:**

- Consumes normalized message/review/timeline rows containing authoritative identity tuples.
- Produces internal pure projection types, `projectCustomerInbox`, and `mergeChangedInboxItems`.
- No repository DTO, live route, Drizzle schema/table reference, or Admin caller changes in this task. Public DTO and live integration remain blocked until Task 11 can load authoritative identity rows.

- [ ] **Step 1: Write failing one-customer/one-box tests**

Create fixtures with explicit identity tuples and separate technical IDs:

```ts
it("projects multiple conversations and sessions for one exact Website identity as one box", () => {
  const items = projectCustomerInbox([
    row({ conversationId: "conversation-1", sessionId: "session-1", identityHash: visitorHash, at: "2026-09-01T07:10:00.000Z", body: "Roll-up" }),
    row({ conversationId: "conversation-2", sessionId: "session-2", identityHash: visitorHash, at: "2026-09-01T07:20:00.000Z", body: "Canvas" }),
  ]);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ lastActivityAt: "2026-09-01T07:20:00.000Z" });
  expect(items[0].timeline.map((event) => event.text)).toEqual(["Roll-up", "Canvas"]);
});

it("never merges two anonymous technical identities", () => {
  const items = projectCustomerInbox([
    row({ identityHash: "a".repeat(64) }),
    row({ identityHash: "b".repeat(64) }),
  ]);
  expect(items).toHaveLength(2);
});

it("updates the same inboxId and moves it above a previously newer customer", () => {
  const next = mergeChangedInboxItems([customerAOld, customerB], [customerANew]);
  expect(next.map((item) => item.inboxId)).toEqual([customerAOld.inboxId, customerB.inboxId]);
  expect(new Set(next.map((item) => item.inboxId)).size).toBe(2);
});
```

Add Facebook PSID, topic switch, repeated review, timeline order, last human outbound/unread count, and raw-identity redaction tests.

- [ ] **Step 2: Verify projection RED**

```bash
npm run test:run -- src/server/customer-service/inbox/customer-inbox.test.ts
```

- [ ] **Step 3: Implement pure grouping and DTOs**

The grouping key is the exact tuple `channel\0identityKind\0identityKeyHash`. Return only an opaque SHA-256 `inboxId`; discard the raw tuple before DTO creation.

Select latest action state by `receivedAt`, then deterministic ID tie-break. Sort timeline oldest-first and Inbox newest-first. Define unread count exactly as customer messages strictly after the most recent human outbound event across linked conversations.

Keep these types internal to the pure module for now. Task 11 promotes the final shape to the repository public DTO only after the authoritative link table exists.

- [ ] **Step 4: Implement pure changed-item merge by `inboxId`**

`mergeChangedInboxItems` replaces an existing item with the same `inboxId`, deduplicates repeated changed inputs, and sorts by `lastActivityAt DESC` with a deterministic `inboxId` tie-break. It does not yet alter `createReplyAssistantUpdateReader`.

- [ ] **Step 5: Run projection and live-update tests**

```bash
npm run test:run -- src/server/customer-service/inbox/customer-inbox.test.ts
```

- [ ] **Step 6: Commit Task 8**

```bash
git add src/server/customer-service/inbox/customer-inbox.ts src/server/customer-service/inbox/customer-inbox.test.ts
git commit -m "feat(reply-assistant): project one inbox item per customer"
```

---

### Task 9: Hash-Only Identity-Link Migration — BLOCKED BY FREEZE

**Files after the freeze is explicitly lifted:**

- Modify: `src/server/db/schema/customer-service.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: the next Drizzle-generated migration file; exact numeric prefix must be selected only after `git fetch origin --prune` and verified lineage state.
- Create: matching Drizzle metadata through `npm run db:generate`; never hand-edit the journal.
- Modify: `src/server/db/schema/website-customer-service-schema.test.ts`
- Create: `src/server/customer-service/identity/customer-identity.integration.test.ts`

**Interfaces:**

- Produces `customerServiceConversationIdentities` with one authoritative identity per technical conversation and an index allowing many conversations per identity tuple.

**Current status:** BLOCKED. Do not create or edit these schema/migration files while the migration freeze is active.

- [ ] **Gate 1: Obtain verified Migration Lineage Reconciliation completion**

Run only after authorization:

```bash
git fetch origin --prune
npm run db:lineage:check
```

Expected: exact lineage check passes against the separately approved target. A failure keeps this task blocked.

- [ ] **Gate 2: Obtain separate explicit approval for the Production database migration**

Report the additive table, deterministic backfill, lock/runtime impact, rollback point, and verification queries before requesting approval.

- [ ] **Step 3: Write the failing schema test**

Assert columns/checks/indexes for:

```ts
{
  conversationId: "uuid primary key",
  channel: "facebook | website",
  identityKind: "four-value enum check",
  identityKeyHash: "64 lowercase hex check",
  createdAt: "timestamptz",
  updatedAt: "timestamptz",
}
```

Assert the non-unique identity lookup index and composite conversation/channel FK. Assert no raw identity columns exist.

- [ ] **Step 4: Add the Drizzle table and generate the formal migration**

The migration must:

1. create the additive link table and indexes;
2. backfill Facebook with existing `external_key_hash`;
3. backfill Website with exactly one consent-linked inquiry visitor digest when unambiguous;
4. fall back to Website `external_key_hash` for missing/conflicting evidence;
5. avoid updating or deleting any existing business row; and
6. add `NOT NULL`/checks only after the complete deterministic backfill.

- [ ] **Step 5: Run migration and identity integration tests on a disposable isolated database**

```bash
npm run release:test:isolated
```

The isolated runner must verify two technical conversations with the same identity tuple, two identities never merging, FK integrity, and backfill counts.

- [ ] **Step 6: Commit Task 9 only after all gates pass**

```bash
git add src/server/db/schema/customer-service.ts src/server/db/schema/index.ts src/server/db/schema/website-customer-service-schema.test.ts src/server/customer-service/identity/customer-identity.integration.test.ts drizzle
git commit -m "feat(reply-assistant): link conversations to customer identity"
```

---

### Task 10: Transactional Identity Persistence and Session Isolation — BLOCKED UNTIL TASK 9

**Files:**

- Modify: `src/app/api/customer-chat/session/route.ts`
- Modify: `src/app/api/customer-chat/session/route-handler.ts`
- Modify: `src/app/api/customer-chat/messages/route.ts`
- Modify: `src/app/api/customer-chat/messages/route-handler.ts`
- Modify: `src/app/api/customer-chat/messages/route.test.ts`
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Modify: `src/server/customer-service/website/customer-chat-identity.integration.test.ts`

**Interfaces:**

- `resolveWebsiteSession` returns the linked Inbox identity internally.
- `ingestConversationEvent` accepts a required exact identity for customer messages.
- Conversation creation and identity-link insert/validation occur in one transaction.

- [ ] **Step 1: Write failing Guest/User A/User B and multi-session tests**

Cover active same-scope reuse, login/logout rotation, User A to User B rotation, two devices for User A producing separate technical conversations linked to the same Inbox identity, permit mismatch rejection, and anonymous fallback separation.

- [ ] **Step 2: Verify RED against the migrated isolated database**

```bash
npm run test:run -- src/server/customer-service/website/customer-chat-identity.integration.test.ts src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
```

- [ ] **Step 3: Resolve authoritative identity in both Website routes**

Inject `getOptionalSession(request.headers)` and stable visitor resolution. Bind the bootstrap permit to the exact identity. Never return identity values in public responses.

- [ ] **Step 4: Persist and verify identity atomically**

On first conversation insert, insert one identity link. On existing conversation, compare the stored tuple with the request tuple and fail closed on mismatch. A mismatch causes session bootstrap rotation; it never reassigns old messages.

- [ ] **Step 5: Run route, identity, rate-limit, and security suites**

```bash
npm run test:run -- src/app/api/customer-chat/session src/app/api/customer-chat/messages src/server/customer-service/website/customer-chat-identity.integration.test.ts src/server/customer-service/website/security-regression.test.ts
```

- [ ] **Step 6: Commit Task 10**

```bash
git add src/app/api/customer-chat/session src/app/api/customer-chat/messages src/server/customer-service/repositories src/server/customer-service/website/customer-chat-identity.integration.test.ts
git commit -m "fix(customer-chat): persist isolated customer identity links"
```

---

### Task 11: Drizzle Inbox Query, Review, and Alert Integration — BLOCKED UNTIL TASK 9

**Files:**

- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Modify: `src/server/customer-service/live-updates.ts`
- Modify: `src/server/customer-service/live-updates.test.ts`

**Interfaces:**

- Repository public types change from message-row `SafeQueuePage` items to one `SafeInboxItem` per identity; `listQueue`, deep-link resolution, and changed-message/conversation loaders return that shape.
- `openWebsiteHumanReview` reuses one open review across linked conversations under an identity advisory lock.

- [ ] **Step 1: Write failing repository tests for A-E**

Seed:

- same PSID with five messages;
- same Website identity with two conversations/sessions and different products;
- two unrelated anonymous identities;
- Customer A old, Customer B newer, then Customer A newest;
- repeated Human Review triggers across Customer A conversations.

Assert one row per customer, chronological combined timeline, `lastActivityAt DESC`, same `inboxId`, latest message action target, one active review selector, and one alert outbox row with incremented dedup count.

- [ ] **Step 2: Verify RED**

```bash
npm run test:run -- src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
```

- [ ] **Step 3: Replace message-row queue selection with identity aggregation**

Load the newest 100 identity tuples first, ordered by maximum event/assistant activity. Then load newest 50 timeline events per selected identity, returning them oldest-first with `hasEarlierTimeline`. Never attach the same timeline once per message.

Promote the tested Task 8 projection shape to the final repository DTO here. Remove the old per-message public queue item shape in the same integration change so no caller can accidentally treat `messageId` as the Inbox identity.

- [ ] **Step 4: Reuse the single Website active review across linked conversations**

Acquire a transaction advisory lock from the identity tuple. If an open review exists on another linked conversation, update that active row to the newest triggering conversation/turn, advance generation, issue a new selector, refresh reason/summary, and increment the existing outbox deduplication count. Resolved historical rows remain unchanged.

- [ ] **Step 5: Run repository/live-update tests on disposable DB**

Change `createReplyAssistantUpdateReader` to deduplicate and sort changed results by `inboxId`/`lastActivityAt`, using the same pure merge helper from Task 8. Add regressions proving two changed technical conversations for one identity produce one changed Inbox item.

```bash
npm run release:test:isolated
```

- [ ] **Step 6: Commit Task 11**

```bash
git add src/server/customer-service/repositories/drizzle-customer-service-repository.ts src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts src/server/customer-service/live-updates.ts src/server/customer-service/live-updates.test.ts
git commit -m "fix(reply-assistant): aggregate inbox and active review by customer"
```

---

### Task 12: Admin Inbox Client Wiring

**Files:**

- Modify: `src/app/reply-assistant/live-dashboard.tsx`
- Modify: `src/app/reply-assistant/live-dashboard.test.tsx`
- Modify: `src/components/reply-assistant/reply-assistant-client.tsx`
- Modify: `src/components/reply-assistant/reply-assistant-client.test.tsx`
- Modify: `src/app/reply-assistant/reply-assistant.module.css`
- Add or modify: authenticated Admin timeline pagination route and tests if `hasEarlierTimeline` is true.

**Interfaces:**

- Consumes `SafeInboxItem` from Task 11.
- Keys all visible and transient client state by `inboxId`.

- [ ] **Step 1: Write failing React tests for A-E**

Assert:

1. two changed payloads with one `inboxId` render one article;
2. a new `latestMessageId` does not remount a duplicate article;
3. the updated box moves first by `lastActivityAt`;
4. timeline combines Roll-up and Canvas events oldest-first;
5. website reply surface occurs once;
6. repeated review changes preserve local text but disable stale selector submission;
7. `Load earlier` prepends without duplicate events.

- [ ] **Step 2: Verify RED**

```bash
npm run test:run -- src/app/reply-assistant/live-dashboard.test.tsx src/components/reply-assistant/reply-assistant-client.test.tsx
```

- [ ] **Step 3: Key and merge by `inboxId`**

Replace all map keys, review/editor state keys, new badges, visible-count accounting, and React article keys that currently use `messageId`. Use `latestMessageId` only in message-level action URLs.

- [ ] **Step 4: Render one timeline/reply surface per customer**

Keep existing visual design tokens and channel badges. Display `lastActivityAt`, review status, and unread count once in the card header. Preserve selected deep-link card pinning without changing the stable Inbox key.

- [ ] **Step 5: Run Admin component/page/API tests**

```bash
npm run test:run -- src/app/reply-assistant src/components/reply-assistant
```

- [ ] **Step 6: Commit Task 12**

```bash
git add src/app/reply-assistant src/components/reply-assistant
git commit -m "fix(reply-assistant): render one live box per customer"
```

---

### Task 13: Full Verification and Review

**Files:** No planned source changes. Any discovered defect returns to a new RED/GREEN cycle in the owning task.

- [ ] **Step 1: Run all focused tests with counts**

```bash
npm run test:run -- src/server/customer-service src/app/api/customer-chat src/app/api/reply-assistant src/app/reply-assistant src/components/customer-chat src/components/reply-assistant src/domain/pricing/market-quote.test.ts
```

- [ ] **Step 2: Run isolated database release verification**

```bash
npm run release:test:isolated
```

- [ ] **Step 3: Run security/governance checks**

```bash
npm run automation:guard
npm run knowledge:check
npm run db:check
npm run db:lineage:check
```

- [ ] **Step 4: Run static and build verification**

```bash
npm run typecheck
npm run lint
npm run build
git diff --check origin/main...HEAD
```

- [ ] **Step 5: Review the final diff**

Confirm no official price constants, policy flags, model/environment values, payment/auth configuration, Production data scripts, IP/fingerprint matching, or unrelated UI changes were introduced.

- [ ] **Step 6: Run browser verification on local or Preview**

Verify desktop and mobile:

- Facebook same identity one box;
- Website same identity across technical conversations one box;
- new Customer A activity updates/moves same box;
- no duplicate box remains;
- Website active chat follows the final reply;
- history reading is not interrupted.

- [ ] **Step 7: Use verification-before-completion and requesting-code-review skills**

Do not claim PASS from old logs or partial suites.

---

### Task 14: Production Release and A-G Evidence

**Prerequisite:** Tasks 9-13 complete; migration separately approved; no Production drift.

- [ ] **Step 1: Fetch and verify authoritative source**

```bash
git fetch origin --prune
```

Confirm the feature branch is based on current `origin/main`, the worktree is clean, and the migration prefix still matches authoritative lineage.

- [ ] **Step 2: Report migration execution plan and rollback point, then obtain explicit approval**

Do not infer approval from ordinary code-change confirmation.

- [ ] **Step 3: Execute the separately approved migration through the governed path**

Never run it while the freeze or lineage blocker remains.

- [ ] **Step 4: Integrate verified commits into `origin/main` without rewriting history**

Use fast-forward or an approved non-rewriting merge. Push `main` and let Vercel Git integration deploy. Never run `vercel --prod` or promote the feature branch.

- [ ] **Step 5: Verify Production source and aliases**

Confirm:

- Vercel Production Branch is `main`;
- `origin/main` SHA equals READY Production SHA;
- `githubCommitRef` is `main`;
- aliases include `rrgallery.co.nz` and `www.rrgallery.co.nz`.

Any mismatch is `PRODUCTION DRIFT DETECTED` and stops verification.

- [ ] **Step 6: Run only authorized Production Guard verification**

Use the repository’s named Production Guard and only approved capabilities/TTL. Do not send Facebook customer messages, create orders, alter Analytics, or bypass Guard.

- [ ] **Step 7: Prove A-G from Production evidence**

Record one explicit PASS/FAIL per acceptance row. If any row lacks direct evidence, report it as FAIL and set:

```text
PRODUCTION READY: NO
```

Only all-seven PASS plus clean release/governance verification permits `PRODUCTION READY: YES`.
