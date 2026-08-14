# Secure Card Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Card selection, secure card entry, final payment, and order confirmation read as one truthful checkout journey.

**Architecture:** Retain the existing pending-order and Stripe PaymentIntent services. Change only presentation components: payment-method branding, contextual action labels, Stripe final action, and payment-state-derived order headings.

**Tech Stack:** Next.js, React, TypeScript, Stripe Elements, CSS Modules, Vitest, Testing Library

## Global Constraints

- Preserve all existing business and payment logic.
- Add no runtime dependency or remote image request.
- Use existing tokens, components, and responsive breakpoints.

---

### Task 1: Truthful payment-state presentation

**Files:**
- Modify: `src/components/order-detail.tsx`
- Modify: `src/components/order-payment-panel.tsx`
- Test: `src/app/orders/order-pages.test.tsx`
- Test: `src/components/order-payment-panel.test.tsx`

- [ ] Add failing tests for unpaid, processing, paid, failed, cancelled, and refunded headings and messages.
- [ ] Run the focused tests and confirm failure.
- [ ] Derive customer-facing headings from authoritative payment status and replace pre-payment success language.
- [ ] Run the focused tests and confirm success.

### Task 2: Card trust and contextual actions

**Files:**
- Modify: `src/components/payment-methods.tsx`
- Modify: `src/components/checkout-view.tsx`
- Modify: `src/components/order-payment-panel.tsx`
- Modify: `src/components/stripe-payment-form.tsx`
- Modify: `src/components/storefront.module.css`
- Test: `src/components/payment-methods.test.tsx`
- Test: `src/components/checkout-view.test.tsx`
- Test: `src/components/order-payment-panel.test.tsx`
- Test: `src/components/stripe-payment-form.test.tsx`

- [ ] Add failing tests for card brands, Stripe safety copy, the continue action, and the amount-specific final action.
- [ ] Run the focused tests and confirm failure.
- [ ] Add local accessible payment marks and contextual button labels without changing API payloads.
- [ ] Run the focused tests and confirm success.

### Task 3: Regression and browser verification

**Files:**
- Verify only the files listed above.

- [ ] Run payment and checkout tests.
- [ ] Run ESLint and `git diff --check`.
- [ ] Verify the live Card path in Chrome at desktop and mobile widths without completing a charge.
