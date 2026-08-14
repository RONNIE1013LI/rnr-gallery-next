# Homepage Gallery Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the five approved Design Gallery artworks as a ratio-preserving product mosaic in Homepage V3.

**Architecture:** Load the five approved active records by ID, preserve their curated slot order, and pass them to the existing Homepage V3 component. Reuse the established gallery image and configurator URLs.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, CSS Modules

## Global Constraints

- Preserve Homepage V3 layout and all downstream business logic.
- Do not change database, admin, pricing, checkout or payment behaviour.
- Do not create duplicate image assets or routes.
- Do not commit changes.

---

### Task 2: Five-artwork ratio-preserving mosaic

**Files:**
- Create: `src/components/homepage-gallery.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/components/homepage-v3.tsx`
- Modify: `src/components/homepage-v3.module.css`
- Test: `src/components/homepage-v3.test.tsx`

**Interfaces:**
- Consumes: `readonly PublicGalleryItem[]` from the existing public gallery service.
- Produces: five ordered selections covering two Canvas designs, Wall Banner, Roll-up Banner and Grave Cover.

- [x] **Step 1: Write failing tests**

Assert the five approved design IDs and slots, four product-filter links, product-format labels and configurator links containing design IDs.

- [x] **Step 2: Verify tests fail**

Run `npm test -- --run src/components/homepage-v3.test.tsx` and confirm the old occasion-led selection fails the new product contract.

- [x] **Step 3: Implement minimal integration**

Update the selector and homepage query, retain the gallery copy and product links, render every source image at its intrinsic aspect ratio, add top-left product-format labels and compose the five real images into one responsive mosaic.

- [x] **Step 4: Verify implementation**

Run the focused tests, TypeScript, ESLint and production build. Use Playwright at 390, 768, 1280 and 1440 to confirm real images, valid links and no horizontal overflow.
