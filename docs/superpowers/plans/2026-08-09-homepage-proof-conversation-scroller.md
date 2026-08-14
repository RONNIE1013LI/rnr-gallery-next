# Homepage Proof Conversation Scroller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the supplied proof-and-approval conversation in the Homepage V3 proof panel with automatic bidirectional scrolling and direct customer control.

**Architecture:** Add one small client component that owns only the proof frame's animation and interaction state. Homepage V3 remains responsible for the surrounding copy and layout; its CSS Module owns the frame presentation.

**Tech Stack:** Next.js App Router, React, TypeScript, CSS Modules, Vitest

## Global Constraints

- Homepage only.
- Preserve the screenshot's full original ratio and content.
- Preserve the existing panel layout, process steps and Approved for Print copy.
- Respect reduced-motion preferences.
- Add no dependency and do not commit.

---

### Task 1: Interactive proof conversation

**Files:**
- Create: `public/media/home/design-proof-customer-confirmation.jpg`
- Create: `src/components/proof-conversation-scroller.tsx`
- Modify: `src/components/homepage-v3.tsx`
- Modify: `src/components/homepage-v3.module.css`
- Test: `src/components/homepage-v3.test.tsx`
- Modify: `design-qa.md`

**Interfaces:**
- Produces: `ProofConversationScroller({ className }: { className?: string })`.
- Consumes: the supplied 493 × 804 JPG and existing Homepage V3 proof-panel styles.

- [ ] **Step 1: Write the failing component regression test**

Render `HomepageV3` and assert that the proof panel contains a focusable region named `Customer design proof and approval conversation`, an image named `Memorial artwork proof followed by the customer's approval to print`, and `data-proof-scroll="auto-manual"`.

- [ ] **Step 2: Verify the test fails**

Run `npm test -- --run src/components/homepage-v3.test.tsx` and confirm the proof conversation region is absent.

- [ ] **Step 3: Add the source asset and minimal client component**

The component renders the supplied image at `493 × 804`, drives `scrollTop` with `requestAnimationFrame`, reverses at both ends, pauses for pointer/focus/touch/wheel/manual scrolling and observes `prefers-reduced-motion`.

- [ ] **Step 4: Replace only the placeholder artwork**

Replace the existing `Artwork` call inside `.proofLayout` with `ProofConversationScroller`. Add a fixed 4:3 scroll viewport, full-width auto-height image, contained overscroll and a subtle scrollbar.

- [ ] **Step 5: Verify behavior and presentation**

Run the focused tests, TypeScript, ESLint and production build. In the real browser, verify desktop and 390px layouts, automatic movement, wheel/touch/manual control, keyboard focus, reduced-motion handling, no horizontal overflow, no broken image and no console errors.
