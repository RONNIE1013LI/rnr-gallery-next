# Afterpay Production Go-Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the existing Afterpay provider for New Zealand NZD checkout in Vercel Production and verify it without making a real payment.

**Architecture:** No application-code change is planned. Add the approved production credentials and market settings to Vercel, verify the live Afterpay configuration, redeploy the already-tested commit, and smoke-check market eligibility and redirect behavior.

**Tech Stack:** Next.js, Vercel CLI, Afterpay Online API V2, Safari Business Hub

## Global Constraints

- New Zealand NZD only; Australian AUD checkout must not offer Afterpay.
- Never print, log, commit, or document Merchant ID or Secret Key values.
- Do not change product prices, tax, shipping, Stripe, orders, or payment calculations.
- Do not complete a real payment; Ronnie performs the final transaction.
- Preserve unrelated untracked files.

---

### Task 1: Validate the release boundary and credentials

**Files:**
- No application files modified.
- Reference: `src/server/payments/config.ts`
- Reference: `src/server/payments/afterpay-provider.ts`
- Reference: `src/server/payments/eligibility.ts`

**Interfaces:**
- Consumes: Afterpay production Merchant ID and Secret Key from Business Hub.
- Produces: authenticated production configuration with NZD minimum and maximum order amounts.

- [ ] **Step 1: Record the exact branch, commit, diff, Vercel project and production aliases**

Run `git status --short --branch`, `git rev-parse HEAD`, `git diff --stat`, and Vercel project inspection. Preserve all unrelated untracked files.

- [ ] **Step 2: Read credentials without exposing them**

Copy Merchant ID and Secret Key separately from Safari Business Hub. Transfer each value directly from the clipboard to Vercel; do not echo or inspect the values.

- [ ] **Step 3: Validate the production account**

Call `GET https://global-api.afterpay.com/v2/configuration` using Basic authentication and the production Merchant ID as the User-Agent. Record only HTTP status, currency, minimum amount, and maximum amount. Expected: HTTP 200 and NZD.

### Task 2: Configure and deploy production

**Files:**
- No application files modified.
- Vercel Production environment only.

**Interfaces:**
- Consumes: validated NZ production credentials.
- Produces: Ready production deployment with Afterpay enabled for NZD.

- [ ] **Step 1: Add sensitive production variables**

Add `AFTERPAY_MERCHANT_ID`, `AFTERPAY_SECRET_KEY`, `AFTERPAY_ENVIRONMENT=production`, and `AFTERPAY_MERCHANT_COUNTRY=NZ` to Vercel Production. Confirm names and scopes using `vercel env ls production` without reading values.

- [ ] **Step 2: Build a production deployment from the exact commit**

Create a Vercel deployment from the current committed source and wait until it is Ready. Do not include unrelated untracked files.

- [ ] **Step 3: Promote the Ready artifact**

Promote that exact Ready deployment to production, then verify `rrgallery.co.nz` and `www.rrgallery.co.nz` point to it.

### Task 3: Smoke-test market and checkout behavior

**Files:**
- No application files modified.

**Interfaces:**
- Consumes: Ready production deployment.
- Produces: evidence that NZD offers Afterpay, AUD does not, and the redirect reaches the production Afterpay portal.

- [ ] **Step 1: Check public routes and provider health**

Verify the home, product, cart, and checkout routes return the expected status and that payment-provider errors are absent.

- [ ] **Step 2: Verify NZ checkout eligibility**

Use an NZ shipping destination and an order within the live minimum/maximum range. Confirm Afterpay is offered with NZD and starts a redirect on `portal.afterpay.com`. Cancel before authorisation.

- [ ] **Step 3: Verify AU isolation**

Use an AU shipping destination and confirm Afterpay is not offered for AUD checkout.

- [ ] **Step 4: Hand off the real payment**

Tell Ronnie the verified amount range and exact checkout path. After Ronnie completes one real payment, verify the order has one immutable NZD pricing snapshot and a confirmed Afterpay payment state.

