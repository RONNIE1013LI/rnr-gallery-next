# Market Switch Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NZ/AU switching complete with one authoritative navigation or show an actionable target-market cart conflict instead of silently reverting.

**Architecture:** Add a pure target-market preflight around the existing authoritative `repriceCart` function, return stable structured API failures, and keep the selector responsible only for temporary user choices and committing a successful server snapshot. A focused dialog component handles confirmation/date editing without changing the stored cart until the API succeeds.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Vitest, Testing Library, existing cart repository and pricing registry.

**Spec:** `docs/superpowers/specs/2026-08-24-internal-notification-center-and-market-switch-design.md`

## Global Constraints

- Keep `/api/market` trusted-origin, bounded JSON, no-store, and server-authoritative.
- Never change the market cookie or persisted cart on a failed repricing.
- Never automatically delete items, change dates, or accept urgent fees.
- Preserve Guest/User identity-scoped cart and checkout isolation.
- Do not weaken `repriceCart` validation or trust client product labels/prices.
- Use the existing design system and add no dependency.
- Remove the duplicate `router.refresh()`; successful switching performs one `router.push()`.
- Do not include the broader homepage rendering/cache architecture in this plan.
- Production deployment is a separate explicit approval gate.

---

### Task 1: Authoritative target-market preflight

**Files:**
- Create: `src/domain/checkout/market-switch-preflight.ts`
- Create: `src/domain/checkout/market-switch-preflight.test.ts`
- Modify: `src/domain/checkout/reprice-cart.ts`

**Interfaces:**
- Consumes: existing `parseCheckoutCartInput(value)` and `repriceCart(value, options)`.
- Produces:

```ts
export type MarketSwitchUrgentIssue = Readonly<{
  clientItemId: string;
  productTitle: string;
  neededDate: string;
  urgentWorkingDays: number;
  urgentFeeInclGstCents: number;
  currency: MarketCurrency;
}>;

export type MarketSwitchPreflightResult =
  | Readonly<{ result: "ready"; cart: RepricedCheckoutCart }>
  | Readonly<{
      result: "urgent_confirmation_required";
      issues: readonly MarketSwitchUrgentIssue[];
    }>;

export function preflightMarketSwitch(
  value: unknown,
  options: RepriceCartOptions,
): MarketSwitchPreflightResult;
```

- `RepriceCartOptions` becomes an exported type from `reprice-cart.ts`; its behavior does not change.

- [ ] **Step 1: Write failing preflight tests**

Add tests proving one request reports every unconfirmed urgent item, uses target-registry titles/currency/fees, returns the ordinary repriced cart when no confirmation is needed, preserves already-confirmed items, and propagates malformed/unavailable cart errors.

```ts
const result = preflightMarketSwitch(twoUrgentItems, {
  now: new Date("2026-08-24T00:00:00.000Z"),
  registry: enabledAuRegistry,
  market: "AU",
  registryRevision: 9,
});

expect(result).toEqual({
  result: "urgent_confirmation_required",
  issues: [
    expect.objectContaining({
      clientItemId: firstId,
      productTitle: "Custom Themed Canvas",
      neededDate: "2026-08-28",
      currency: "AUD",
      urgentFeeInclGstCents: expect.any(Number),
    }),
    expect.objectContaining({ clientItemId: secondId, currency: "AUD" }),
  ],
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run test:run -- src/domain/checkout/market-switch-preflight.test.ts`

Expected: FAIL because `preflightMarketSwitch` does not exist.

- [ ] **Step 3: Export the existing reprice options type**

Change only the declaration in `reprice-cart.ts`:

```ts
export type RepriceCartOptions = Readonly<{
  now?: Date;
  galleryDesigns?: ReadonlyMap<string, GalleryDesignSnapshot>;
  registry?: ProductRegistryDocument;
  market?: Market;
  registryRevision?: number;
}>;
```

- [ ] **Step 4: Implement the non-mutating preflight**

Use one validation pass that temporarily confirms every item only in an in-memory preview, then derive issues from the authoritative preview. Reprice the original input again only when no issue exists so unnecessary confirmation flags are never persisted.

```ts
export function preflightMarketSwitch(
  value: unknown,
  options: RepriceCartOptions,
): MarketSwitchPreflightResult {
  const input = parseCheckoutCartInput(value);
  const assumedConfirmed = {
    version: 1 as const,
    items: input.items.map((item) => ({ ...item, urgentServiceConfirmed: true })),
  };
  const preview = repriceCart(assumedConfirmed, options);
  const originalById = new Map(input.items.map((item) => [item.clientItemId, item]));
  const issues = preview.items
    .filter((item) => (
      originalById.get(item.clientItemId)?.urgentServiceConfirmed !== true &&
      item.urgentService.feeInclGstCents > 0
    ))
    .map((item) => Object.freeze({
      clientItemId: item.clientItemId,
      productTitle: item.productTitle,
      neededDate: item.neededDate,
      urgentWorkingDays: item.urgentService.workingDays,
      urgentFeeInclGstCents: item.urgentService.feeInclGstCents,
      currency: preview.currency,
    }));
  return issues.length > 0
    ? Object.freeze({
        result: "urgent_confirmation_required" as const,
        issues: Object.freeze(issues),
      })
    : Object.freeze({ result: "ready" as const, cart: repriceCart(value, options) });
}
```

- [ ] **Step 5: Run preflight and existing pricing tests**

Run: `npm run test:run -- src/domain/checkout/market-switch-preflight.test.ts src/domain/checkout/reprice-cart.test.ts`

Expected: PASS; existing checkout rejection behavior remains unchanged.

- [ ] **Step 6: Commit the domain unit**

```bash
git add src/domain/checkout/market-switch-preflight.ts src/domain/checkout/market-switch-preflight.test.ts src/domain/checkout/reprice-cart.ts
git commit -m "fix: preflight target market cart conflicts"
```

### Task 2: Structured `/api/market` results

**Files:**
- Modify: `src/app/api/market/route-handler.ts`
- Modify: `src/app/api/market/route.test.ts`

**Interfaces:**
- Consumes: `preflightMarketSwitch(body.cart, { registry, registryRevision, market })`.
- Produces:

```ts
type MarketRouteFailure = Readonly<{
  error: string;
  code:
    | "unsupported_market"
    | "market_unavailable"
    | "urgent_confirmation_required"
    | "invalid_cart"
    | "market_switch_failed";
  issues?: readonly MarketSwitchUrgentIssue[];
}>;
```

- [ ] **Step 1: Add failing route-contract tests**

Add assertions for all of these behaviors:

```ts
expect(response.status).toBe(409);
expect(response.headers.get("Set-Cookie")).toBeNull();
expect(await response.json()).toEqual({
  error: "Confirm urgent service or choose another completion date.",
  code: "urgent_confirmation_required",
  issues: expect.arrayContaining([
    expect.objectContaining({ clientItemId, currency: "AUD" }),
  ]),
});
```

Also assert stable codes for unsupported/disabled markets and invalid carts, no raw error details on 500, and the unchanged success body/cookie.

- [ ] **Step 2: Run the route test and confirm RED**

Run: `npm run test:run -- src/app/api/market/route.test.ts`

Expected: FAIL because current failures contain only `error` and urgent conflicts are not structured.

- [ ] **Step 3: Route cart requests through preflight**

Use this branch before constructing the success response:

```ts
const preflight = body.cart === undefined
  ? null
  : preflightMarketSwitch(body.cart, {
      registry,
      registryRevision: revision,
      market,
    });
if (preflight?.result === "urgent_confirmation_required") {
  return Response.json({
    error: "Confirm urgent service or choose another completion date.",
    code: "urgent_confirmation_required",
    issues: preflight.issues,
  }, { status: 409, headers: { "Cache-Control": "no-store" } });
}
const cart = preflight?.result === "ready" ? preflight.cart : undefined;
```

Map trusted mutation, unsupported market, disabled market, `InvalidCheckoutCartError`, and unknown failures to the stable safe codes. Only the final success response calls `marketCookieHeader(...)`.

- [ ] **Step 4: Run route and preflight tests**

Run: `npm run test:run -- src/app/api/market/route.test.ts src/domain/checkout/market-switch-preflight.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the API contract**

```bash
git add src/app/api/market/route-handler.ts src/app/api/market/route.test.ts
git commit -m "fix: return actionable market switch conflicts"
```

### Task 3: Responsive urgent-confirmation dialog and single navigation

**Files:**
- Create: `src/components/market-switch-dialog.tsx`
- Create: `src/components/market-switch-dialog.module.css`
- Create: `src/components/market-switch-dialog.test.tsx`
- Modify: `src/components/market-selector.tsx`
- Modify: `src/components/market-selector.test.tsx`

**Interfaces:**
- Consumes: the Task 2 success/failure response and existing `CartRepository`.
- Produces:

```ts
type MarketRoutePayload =
  | Readonly<{
      market: Market;
      currency: MarketCurrency;
      cart?: RepricedCheckoutCart;
    }>
  | Readonly<{
      error: string;
      code: "unsupported_market" | "market_unavailable" |
        "urgent_confirmation_required" | "invalid_cart" | "market_switch_failed";
      issues?: readonly MarketSwitchUrgentIssue[];
    }>;

export type MarketSwitchDialogState = Readonly<{
  targetMarket: Market;
  cart: Cart;
  issues: readonly MarketSwitchUrgentIssue[];
  message: string;
}>;

export function MarketSwitchDialog(props: Readonly<{
  state: MarketSwitchDialogState;
  pending: boolean;
  onDateChange: (clientItemId: string, neededDate: string) => void;
  onConfirmUrgent: () => void;
  onTryDates: () => void;
  onCancel: () => void;
}>): React.ReactNode;
```

- [ ] **Step 1: Add failing selector/dialog tests**

Cover all approved interaction outcomes:

```ts
fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
  target: { value: "NZ" },
});
expect(await screen.findByRole("dialog", { name: "Review urgent service" }))
  .toBeInTheDocument();
expect(screen.getByText("Custom Themed Canvas")).toBeInTheDocument();

fireEvent.click(screen.getByRole("button", { name: "Confirm urgent service and switch" }));
await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
expect(refresh).not.toHaveBeenCalled();
```

Add separate tests for changing an affected date (retry body has the new date and `urgentServiceConfirmed:false`), cancelling without storage/cookie navigation effects, multiple issues, visible non-urgent API errors, ignored double clicks, Escape close, focus restore, and identity-isolated checkout cleanup on success.

- [ ] **Step 2: Run focused component tests and confirm RED**

Run: `npm run test:run -- src/components/market-switch-dialog.test.tsx src/components/market-selector.test.tsx`

Expected: FAIL because the dialog and structured retry flow do not exist.

- [ ] **Step 3: Implement the accessible dialog**

Render server-provided titles/fees, use native date inputs, trap Tab within dialog controls, close on Escape, lock body scroll while open, and restore focus to the selector on close. Format fees with the existing market-money formatter.

```tsx
<div className={styles.backdrop} role="presentation">
  <section
    ref={dialogRef}
    className={styles.dialog}
    role="dialog"
    aria-modal="true"
    aria-labelledby="market-switch-dialog-title"
  >
    <h2 id="market-switch-dialog-title">Review urgent service</h2>
    {state.issues.map((issue) => (
      <label key={issue.clientItemId}>
        <strong>{issue.productTitle}</strong>
        <span>{formatMarketMoney(issue.urgentFeeInclGstCents, issue.currency)}</span>
        <input
          type="date"
          value={state.cart.items.find((item) => item.id === issue.clientItemId)?.neededDate ?? ""}
          onChange={(event) => onDateChange(issue.clientItemId, event.target.value)}
        />
      </label>
    ))}
  </section>
</div>
```

- [ ] **Step 4: Refactor the selector into one retryable switch function**

Keep all cart mutations temporary until success:

```ts
async function attemptSwitch(next: Market, candidateCart: Cart) {
  const response = await fetch("/api/market", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      market: next,
      ...(candidateCart.items.length > 0
        ? { cart: cartToCheckoutInput(candidateCart) }
        : {}),
    }),
  });
  const payload = await response.json() as MarketRoutePayload;
  if (!response.ok) return { ok: false as const, payload };
  if (candidateCart.items.length > 0 && !payload.cart) {
    return {
      ok: false as const,
      payload: { error: "The repriced cart was missing.", code: "market_switch_failed" },
    };
  }
  return { ok: true as const, payload };
}
```

Confirm urgent service by setting `urgentServiceConfirmed:true` only on listed IDs. Date edits update only the temporary cart and reset that item's flag to false. On success save `applyAuthoritativeRepricing(candidateCart, payload.cart)`, notify observers, clear only active-identity checkout state, dispatch the market event, and call `router.push(...)` once. Do not call `router.refresh()`.

- [ ] **Step 5: Add responsive styles**

Use a fixed dimmed backdrop, a centered desktop card, a bottom-sheet-like mobile card under 560px, 44px minimum action targets, and no global CSS changes. Preserve the existing site-header selector dimensions.

- [ ] **Step 6: Run all market/cart component tests**

Run: `npm run test:run -- src/components/market-switch-dialog.test.tsx src/components/market-selector.test.tsx src/domain/cart/cart.test.ts src/domain/cart/browser-cart-repository.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the client flow**

```bash
git add src/components/market-switch-dialog.tsx src/components/market-switch-dialog.module.css src/components/market-switch-dialog.test.tsx src/components/market-selector.tsx src/components/market-selector.test.tsx
git commit -m "fix: guide customers through market cart conflicts"
```

### Task 4: Whole-feature verification and release checkpoint

**Files:**
- Modify only if verification exposes a scoped defect in Task 1-3 files.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: a verified market-switch commit set ready to integrate with the notification-center branch work.

- [ ] **Step 1: Run all focused market tests**

Run:

```bash
npm run test:run -- src/domain/checkout/market-switch-preflight.test.ts src/domain/checkout/reprice-cart.test.ts src/app/api/market/route.test.ts src/components/market-switch-dialog.test.tsx src/components/market-selector.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run static checks**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run lint -- src/domain/checkout/market-switch-preflight.ts src/app/api/market/route-handler.ts src/components/market-switch-dialog.tsx src/components/market-selector.tsx`

Expected: PASS with no new warning.

- [ ] **Step 3: Verify the real browser flow locally**

Start: `npm run dev -- --hostname 0.0.0.0`

Use `http://192.168.4.199:3000` and verify:

1. empty-cart NZ→AU→NZ performs one transition each;
2. an urgent cart shows every affected product and authoritative fee;
3. confirm urgent switches and retains the item;
4. changing the date retries and switches without accepting the old fee;
5. cancel preserves market and cart;
6. a safe non-urgent validation error is visible; and
7. mobile selector/dialog remain usable.

- [ ] **Step 4: Run the production build guard locally**

Run: `npm run build`

Expected: PASS in local/Preview mode. Do not run `vercel --prod`.

- [ ] **Step 5: Review the final diff and checkpoint**

Run:

```bash
git diff origin/main...HEAD -- src/domain/checkout src/app/api/market src/components/market-selector.tsx src/components/market-selector.test.tsx src/components/market-switch-dialog.tsx src/components/market-switch-dialog.module.css src/components/market-switch-dialog.test.tsx
git status --short --branch
```

Expected: only approved market-switch files plus committed planning documents; worktree clean. Stop and report verification evidence. Production deployment remains unapproved until the user explicitly authorizes the combined release.
