# Homepage Gallery Width Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the desktop Homepage gallery mosaic and its footer link with the existing 80.5rem homepage content container without changing mobile composition or image proportions.

**Architecture:** Keep the existing gallery DOM and grid ratios. Change only the desktop mosaic width and gallery-link offset in the Homepage V3 CSS module, protected by a source-level regression assertion and browser viewport checks.

**Tech Stack:** Next.js, React, CSS Modules, Vitest, Playwright CLI.

## Global Constraints

- Preserve gallery data, image proportions, gaps, labels, ordering and links.
- Preserve the current layout at 760px and below.
- Do not modify any other homepage section.
- Do not commit.

---

### Task 1: Align the desktop gallery mosaic

**Files:**
- Modify: `src/components/homepage-v3.module.css`
- Test: `src/components/homepage-v3.test.tsx`

**Interfaces:**
- Consumes: `--v3-content-width: 80.5rem` and the existing `.shell` container.
- Produces: `.galleryMosaic` and `.galleryLink` aligned to the shell edges on desktop.

- [x] **Step 1: Write the failing test**

Assert that `.galleryMosaic` uses `width: 100%` and `.galleryLink` has no calculated inset.

- [x] **Step 2: Run the focused Homepage test and verify it fails**

Run: `npm test -- --run src/components/homepage-v3.test.tsx`

- [x] **Step 3: Apply the minimal CSS change**

Set the mosaic to the shell width and the gallery link left margin to zero. Do not alter the grid columns, gaps or mobile rules.

- [x] **Step 4: Run automated verification**

Run the Homepage test, TypeScript, ESLint and `git diff --check`.

- [x] **Step 5: Run browser regression checks**

Verify 768px, 1280px and 1440px, with special attention to edge alignment, root overflow, image proportions and unchanged mobile behavior.
