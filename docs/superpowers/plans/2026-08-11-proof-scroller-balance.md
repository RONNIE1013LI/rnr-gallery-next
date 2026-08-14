# Proof Scroller Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the unused height in the desktop proof panel to enlarge the scrolling proof image while moving the approval box lower.

**Architecture:** Add one semantic class to the existing left proof column. On multi-column layouts, make that column fill the right-hand steps height and let the scroller absorb the remaining space; on mobile, retain the existing 4:3 scroller ratio.

**Tech Stack:** React, TypeScript, CSS Modules, Vitest, Playwright.

## Global Constraints

- Do not change copy, imagery, right-hand steps, colours, typography, or the outer section layout.
- Preserve the existing mobile proof layout and 4:3 scroller ratio.
- Do not commit the changes.

---

### Task 1: Balance the proof visual column

**Files:**
- Modify: `src/components/homepage-v3.tsx`
- Modify: `src/components/homepage-v3.module.css`
- Test: `src/components/homepage-v3.test.tsx`

**Interfaces:**
- Consumes: existing `ProofConversationScroller`, `proofLayout`, `proofConversation`, and `approvedBox` styles.
- Produces: a `proofVisualColumn` layout class used only by the proof panel.

- [ ] **Step 1: Write the failing test**

Assert that the left proof column stretches vertically, the scroller can grow on desktop, and the mobile rule restores the 4:3 ratio.

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run `npm run test:run -- src/components/homepage-v3.test.tsx`.

- [ ] **Step 3: Implement the minimal layout change**

Add `proofVisualColumn` to the existing wrapper and CSS rules that use flex growth only above the mobile breakpoint.

- [ ] **Step 4: Run focused tests and browser regression**

Verify 390px, 768px, and 1440px layouts, then run TypeScript, ESLint, and `git diff --check`.
