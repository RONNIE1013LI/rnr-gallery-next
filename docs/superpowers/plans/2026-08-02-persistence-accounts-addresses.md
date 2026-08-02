# Persistence, Accounts and Addresses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostgreSQL persistence, Better Auth customer accounts, and one secure saved-address system for New Zealand and Australia without changing the existing cart, configurator, pricing, upload, or WordPress systems.

**Architecture:** PostgreSQL is accessed only through Drizzle modules under `src/server`. Better Auth owns users, credentials, and sessions; application tables reference Better Auth user IDs. A country-aware Zod schema is the single validation boundary for account and checkout addresses, while React components consume typed route handlers and never import database or authentication internals.

**Tech Stack:** Next.js 16.2.12, React 19.2.4, TypeScript 5, Vitest 4.1.10, PostgreSQL, Drizzle ORM 0.45.2, Better Auth 1.6.25, Zod 4.4.3, libphonenumber-js 1.13.10.

## Global Constraints

- Work only in `/Users/ronnieli/Documents/海报制作/rnr-next-platform`.
- Do not modify `/Users/ronnieli/Documents/海报制作/rnr-wordpress-staging` or connect to its database.
- Preserve the current cart, product configurator, pricing, upload references, urgent-service rules, visual tokens, and responsive system.
- Guest checkout remains available; creating an account is never required to buy.
- Supported address countries for this release are exactly `NZ` and `AU`.
- Billing, delivery, and saved addresses use the same field model and country-aware validation.
- New Zealand and Australia both use four-digit postcodes; Australian region must be one of `NSW`, `VIC`, `QLD`, `WA`, `SA`, `TAS`, `ACT`, or `NT`.
- Account authorization must validate the database session on the server; cookie existence alone is not authorization.
- `.env.example` contains names with empty values only. Never commit credentials or a populated `.env` file.
- Production startup never mutates the database schema automatically; committed SQL migrations are the only production schema path.

---

## File Map

- `package.json`, `package-lock.json`: pinned database, authentication, validation, and phone parsing dependencies plus migration scripts.
- `.env.example`: empty documented variables for PostgreSQL and Better Auth.
- `drizzle.config.ts`: Drizzle schema and migration configuration.
- `src/server/db/client.ts`: guarded PostgreSQL pool and Drizzle client.
- `src/server/db/schema/auth.ts`: Better Auth generated Drizzle schema.
- `src/server/db/schema/addresses.ts`: application-owned saved-address table.
- `src/server/db/schema/index.ts`: schema barrel passed to Drizzle and Better Auth.
- `drizzle/*.sql`, `drizzle/meta/*`: committed generated migrations.
- `src/domain/address/schema.ts`: canonical NZ/AU validation and normalization.
- `src/domain/address/types.ts`: public country, region, address, and error types.
- `src/server/auth.ts`: Better Auth server configuration.
- `src/lib/auth-client.ts`: browser Better Auth client.
- `src/app/api/auth/[...all]/route.ts`: Better Auth Next.js route.
- `src/server/auth/require-session.ts`: database-backed server authorization helper.
- `src/components/auth-form.tsx`: shared sign-in/register client form.
- `src/app/account/sign-in/page.tsx`, `src/app/account/register/page.tsx`: authentication pages.
- `src/server/addresses/address-repository.ts`: repository interface.
- `src/server/addresses/drizzle-address-repository.ts`: owner-scoped Drizzle implementation.
- `src/app/api/account/addresses/route.ts`: list/create endpoints.
- `src/app/api/account/addresses/[addressId]/route.ts`: update/delete endpoints.
- `src/components/address-form.tsx`: shared country-aware address form.
- `src/components/saved-addresses.tsx`: saved-address list and edit/delete controls.
- `src/app/account/page.tsx`, `src/app/account/addresses/page.tsx`: protected account pages.
- `src/components/storefront.module.css`: existing-token account and form presentation only.
- Tests live beside each domain, repository, route, and component module following the existing project convention.

---

### Task 1: PostgreSQL and migration foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `.env.example`
- Create: `drizzle.config.ts`
- Create: `src/server/db/client.ts`
- Create: `src/server/db/client.test.ts`

**Interfaces:**
- Produces: `getDatabaseUrl(env?: NodeJS.ProcessEnv): string`
- Produces: `getDatabase()`, the lazy server-only Drizzle PostgreSQL client used
  by later tasks.

- [ ] **Step 1: Write the failing environment-boundary test**

```ts
import { describe, expect, it } from "vitest";
import { getDatabaseUrl } from "./client";

describe("database configuration", () => {
  it("fails closed without DATABASE_URL", () => {
    expect(() => getDatabaseUrl({})).toThrow("DATABASE_URL is required");
  });

  it("returns the configured PostgreSQL URL", () => {
    expect(getDatabaseUrl({ DATABASE_URL: "postgresql://db.example/rnr" }))
      .toBe("postgresql://db.example/rnr");
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npm run test:run -- src/server/db/client.test.ts`

Expected: FAIL because `src/server/db/client.ts` does not exist.

- [ ] **Step 3: Install pinned runtime and development dependencies**

Run:

```bash
npm install better-auth@1.6.25 @better-auth/drizzle-adapter@1.6.25 drizzle-orm@0.45.2 pg@8.22.0 zod@4.4.3 libphonenumber-js@1.13.10
npm install --save-dev drizzle-kit@0.31.10 @types/pg@8.20.3
```

Add these scripts to `package.json`:

```json
{
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:check": "drizzle-kit check"
}
```

- [ ] **Step 4: Add empty environment documentation and Drizzle configuration**

`.env.example`:

```dotenv
DATABASE_URL=
BETTER_AUTH_URL=
BETTER_AUTH_SECRET=
```

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 5: Implement the guarded database client**

```ts
import { drizzle } from "drizzle-orm/node-postgres";

export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

let database: ReturnType<typeof drizzle> | undefined;

export function getDatabase(): ReturnType<typeof drizzle> {
  database ??= drizzle(getDatabaseUrl());
  return database;
}
```

- [ ] **Step 6: Run focused verification**

Run: `npm run test:run -- src/server/db/client.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the database foundation**

```bash
git add package.json package-lock.json .env.example drizzle.config.ts src/server/db/client.ts src/server/db/client.test.ts
git commit -m "chore: add PostgreSQL persistence foundation"
```

---

### Task 2: Country-aware address domain

**Files:**
- Create: `src/domain/address/types.ts`
- Create: `src/domain/address/schema.ts`
- Create: `src/domain/address/schema.test.ts`

**Interfaces:**
- Produces: `SUPPORTED_COUNTRIES`, `AUSTRALIAN_REGIONS`, `addressInputSchema`, `normalizeAddress(input)`.
- Produces: `AddressInput` and `NormalizedAddress` with `country`, `fullName`, `building`, `street`, `suburb`, `region`, `postcode`, `phone`, and `email`.

- [ ] **Step 1: Write failing NZ/AU validation tests**

```ts
import { describe, expect, it } from "vitest";
import { addressInputSchema, normalizeAddress } from "./schema";

const base = {
  fullName: "Alex Morgan",
  building: "",
  street: "12 Queen Street",
  suburb: "Central",
  postcode: "1010",
  email: "alex@example.com",
};

describe("addressInputSchema", () => {
  it("accepts and normalizes a New Zealand address", () => {
    const result = normalizeAddress({
      ...base, country: "NZ", region: "Auckland", phone: "021 123 4567",
    });
    expect(result).toMatchObject({ country: "NZ", postcode: "1010" });
    expect(result.phone).toMatch(/^\+64/);
  });

  it("accepts an Australian state and normalizes its phone", () => {
    const result = normalizeAddress({
      ...base, country: "AU", region: "NSW", postcode: "2000", phone: "0412 345 678",
    });
    expect(result).toMatchObject({ country: "AU", region: "NSW" });
    expect(result.phone).toMatch(/^\+61/);
  });

  it("rejects an Australian address with a non-Australian region", () => {
    const result = addressInputSchema.safeParse({
      ...base, country: "AU", region: "Auckland", postcode: "2000", phone: "0412 345 678",
    });
    expect(result.success).toBe(false);
  });

  it.each(["123", "12345", "ABCD"])("rejects postcode %s", (postcode) => {
    expect(addressInputSchema.safeParse({
      ...base, country: "NZ", region: "Auckland", postcode, phone: "021 123 4567",
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:run -- src/domain/address/schema.test.ts`

Expected: FAIL because the address modules do not exist.

- [ ] **Step 3: Define the stable address types**

```ts
export const SUPPORTED_COUNTRIES = ["NZ", "AU"] as const;
export const AUSTRALIAN_REGIONS = [
  "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT",
] as const;

export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];
export type AddressInput = Readonly<{
  country: SupportedCountry;
  fullName: string;
  building: string;
  street: string;
  suburb: string;
  region: string;
  postcode: string;
  phone: string;
  email: string;
}>;
export type NormalizedAddress = AddressInput;
```

- [ ] **Step 4: Implement one schema with country-specific refinements**

Use `z.object`, `superRefine`, and `parsePhoneNumberFromString`. Require all fields except `building`, trim whitespace, require `/^\d{4}$/`, validate AU region membership, parse the phone using the submitted country, require `isValid()`, and return the international phone string from `normalizeAddress`.

The public function must have this exact signature:

```ts
export function normalizeAddress(input: unknown): NormalizedAddress {
  const parsed = addressInputSchema.parse(input);
  const phone = parsePhoneNumberFromString(parsed.phone, parsed.country);
  if (!phone?.isValid()) throw new Error("Phone number is invalid for the selected country");
  return Object.freeze({ ...parsed, phone: phone.number });
}
```

- [ ] **Step 5: Run domain verification**

Run: `npm run test:run -- src/domain/address/schema.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the address domain**

```bash
git add src/domain/address
git commit -m "feat: validate New Zealand and Australian addresses"
```

---

### Task 3: Better Auth schema and server integration

**Files:**
- Create: `src/server/auth.ts`
- Create: `src/lib/auth-client.ts`
- Create: `src/app/api/auth/[...all]/route.ts`
- Create: `src/server/auth/require-session.ts`
- Create: `src/server/auth/require-session.test.ts`
- Create: `src/server/db/schema/auth.ts`
- Create: `src/server/db/schema/index.ts`
- Create: `drizzle/0000_*.sql`
- Create: `drizzle/meta/*`

**Interfaces:**
- Produces: `auth`, `authClient`, `requireSession()`.
- Consumes: `getDatabase()` from Task 1.

- [ ] **Step 1: Write the failing authorization-helper test**

```ts
import { describe, expect, it, vi } from "vitest";
import { requireSessionFrom } from "./require-session";

describe("requireSessionFrom", () => {
  it("rejects a missing database-backed session", async () => {
    const getSession = vi.fn().mockResolvedValue(null);
    await expect(requireSessionFrom(getSession, new Headers()))
      .rejects.toMatchObject({ status: 401 });
  });

  it("returns the authenticated user", async () => {
    const session = { user: { id: "user-1", email: "a@example.com" }, session: {} };
    const getSession = vi.fn().mockResolvedValue(session);
    await expect(requireSessionFrom(getSession, new Headers())).resolves.toBe(session);
  });
});
```

- [ ] **Step 2: Create the initial Better Auth configuration**

```ts
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getDatabase } from "@/server/db/client";

export const auth = betterAuth({
  appName: "R&R Gallery",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDatabase(), { provider: "pg" }),
  emailAndPassword: { enabled: true },
  plugins: [nextCookies()],
});
```

- [ ] **Step 3: Generate the official Better Auth Drizzle schema**

Run:

```bash
npx auth@1.6.25 generate --config ./src/server/auth.ts --output ./src/server/db/schema/auth.ts --yes
```

Expected: generated `user`, `session`, `account`, and `verification` table definitions. Do not hand-edit password or session columns.

- [ ] **Step 4: Pass the generated schema explicitly to the adapter**

Create `src/server/db/schema/index.ts` exporting the generated schema. Update the adapter call to:

```ts
database: drizzleAdapter(getDatabase(), {
  provider: "pg",
  schema: authSchema,
}),
```

- [ ] **Step 5: Add the Next.js handler, client, and session helper**

`src/app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";
export const { GET, POST } = toNextJsHandler(auth);
```

`src/lib/auth-client.ts`:

```ts
"use client";
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient();
```

`requireSessionFrom` accepts an injected `getSession` for tests; `requireSession` calls `auth.api.getSession({ headers: await headers() })`. Both throw a small `HttpError` with status `401` when no session exists.

- [ ] **Step 6: Generate the first SQL migration**

Run: `npm run db:generate`

Expected: one committed SQL migration covering only Better Auth tables.

- [ ] **Step 7: Run focused verification**

Run: `npm run test:run -- src/server/auth/require-session.test.ts && npm run db:check && npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit authentication infrastructure**

```bash
git add src/server/auth.ts src/lib/auth-client.ts src/app/api/auth src/server/auth src/server/db/schema drizzle
git commit -m "feat: add database-backed customer authentication"
```

---

### Task 4: Sign-in and registration experience

**Files:**
- Create: `src/components/auth-form.tsx`
- Create: `src/components/auth-form.test.tsx`
- Create: `src/app/account/sign-in/page.tsx`
- Create: `src/app/account/register/page.tsx`
- Modify: `src/components/storefront.module.css`

**Interfaces:**
- Consumes: `authClient.signIn.email`, `authClient.signUp.email`.
- Produces: `<AuthForm mode="sign-in" | "register" />`.

- [ ] **Step 1: Write failing user-flow tests**

Test exact behaviors: labels are associated with inputs; registration includes full name; submit is disabled while pending; a failed request renders an `aria-live="polite"` message; success uses `router.replace("/account")`; links allow switching between sign-in and registration.

```tsx
render(<AuthForm mode="sign-in" client={fakeClient} />);
await user.type(screen.getByLabelText("Email address"), "alex@example.com");
await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
await user.click(screen.getByRole("button", { name: "Sign in" }));
expect(fakeClient.signIn.email).toHaveBeenCalledWith({
  email: "alex@example.com",
  password: "correct horse battery staple",
});
```

- [ ] **Step 2: Run the component test and verify it fails**

Run: `npm run test:run -- src/components/auth-form.test.tsx`

Expected: FAIL because `AuthForm` does not exist.

- [ ] **Step 3: Implement the shared client form**

Use local controlled fields and the injected client defaulting to `authClient`. Preserve the provider error message without exposing stack traces. Use `autocomplete="email"`, `current-password`, `new-password`, and `name` correctly. Minimum password length is eight characters, matching the server configuration.

- [ ] **Step 4: Add semantic pages using existing storefront tokens**

Each page uses the existing `legalPage`, heading, body, field, button, focus, and responsive conventions. Add only focused auth classes; do not introduce new colors, radii, or shadows.

- [ ] **Step 5: Run component and accessibility regression tests**

Run: `npm run test:run -- src/components/auth-form.test.tsx src/components/site-shell.test.tsx && npm run lint && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the account entry flow**

```bash
git add src/components/auth-form.tsx src/components/auth-form.test.tsx src/app/account/sign-in src/app/account/register src/components/storefront.module.css
git commit -m "feat: add customer sign-in and registration"
```

---

### Task 5: Owner-scoped saved-address persistence

**Files:**
- Create: `src/server/db/schema/addresses.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `src/server/addresses/address-repository.ts`
- Create: `src/server/addresses/drizzle-address-repository.ts`
- Create: `src/server/addresses/drizzle-address-repository.test.ts`
- Create: `drizzle/0001_*.sql`
- Modify: `drizzle/meta/*`

**Interfaces:**
- Produces: `SavedAddress`, `CreateAddressInput`, `AddressRepository`.
- Produces: `createDrizzleAddressRepository(database)` with `listByOwner`, `findByOwner`, `create`, `updateByOwner`, and `deleteByOwner`.
- Consumes: `NormalizedAddress` and Better Auth `user.id`.

- [ ] **Step 1: Write failing repository ownership tests**

Start a disposable PostgreSQL test database, apply committed migrations before
the suite, and verify that user A can create/list/update/delete their address
while user B cannot read, modify, or delete it.

```bash
docker run --name rnr-next-test-db --rm -d \
  -e POSTGRES_USER=rnr_test \
  -e POSTGRES_PASSWORD=rnr_test \
  -e POSTGRES_DB=rnr_test \
  -p 55432:5432 postgres:17-alpine
export TEST_DATABASE_URL=postgresql://rnr_test:rnr_test@127.0.0.1:55432/rnr_test
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
```

```ts
const created = await repository.create("user-a", nzAddress);
expect(await repository.findByOwner("user-a", created.id)).toMatchObject(nzAddress);
expect(await repository.findByOwner("user-b", created.id)).toBeNull();
expect(await repository.updateByOwner("user-b", created.id, auAddress)).toBeNull();
expect(await repository.deleteByOwner("user-b", created.id)).toBe(false);
```

- [ ] **Step 2: Run the repository test and verify it fails**

Run: `TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:run -- src/server/addresses/drizzle-address-repository.test.ts`

Expected: FAIL because the address table and repository do not exist.

- [ ] **Step 3: Define the saved-address table**

Create a UUID primary key, non-null `ownerId` foreign key to Better Auth user ID with cascade delete, all normalized address columns, `createdAt`, and `updatedAt`. Add an index on `ownerId`. Country is a two-character text value constrained in application code to `NZ | AU`.

- [ ] **Step 4: Implement the repository with ownership in every WHERE clause**

Never load by address ID alone. `findByOwner`, `updateByOwner`, and `deleteByOwner` must combine `eq(addresses.id, addressId)` with `eq(addresses.ownerId, ownerId)`. `create` accepts only `NormalizedAddress`, not raw request data.

- [ ] **Step 5: Generate and inspect the address migration**

Run: `npm run db:generate && npm run db:check`

Expected: a second migration adding `customer_addresses`, owner foreign key, and owner index without altering Better Auth column definitions.

- [ ] **Step 6: Run integration and type verification**

Run: `TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:run -- src/server/addresses/drizzle-address-repository.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit saved-address persistence**

```bash
git add src/server/db/schema src/server/addresses drizzle
git commit -m "feat: persist owner-scoped customer addresses"
```

---

### Task 6: Authorized address API

**Files:**
- Create: `src/app/api/account/addresses/route.ts`
- Create: `src/app/api/account/addresses/[addressId]/route.ts`
- Create: `src/app/api/account/addresses/route.test.ts`
- Create: `src/app/api/account/addresses/[addressId]/route.test.ts`

**Interfaces:**
- `GET /api/account/addresses` returns `{ addresses: SavedAddress[] }`.
- `POST /api/account/addresses` returns `{ address: SavedAddress }`, status `201`.
- `PUT /api/account/addresses/:id` returns `{ address: SavedAddress }`.
- `DELETE /api/account/addresses/:id` returns status `204`.
- Errors use `{ error: { code: string; message: string; fields?: Record<string, string[]> } }`.

- [ ] **Step 1: Write failing route contract tests**

Inject session and repository dependencies through exported handler factories. Cover unauthenticated `401`, invalid country/postcode/region `422`, successful NZ and AU create/update, foreign-owner `404`, and delete `204`.

```ts
const response = await handlers.POST(requestWith(auAddress), context);
expect(response.status).toBe(201);
expect(await response.json()).toMatchObject({
  address: { country: "AU", region: "NSW", postcode: "2000" },
});
```

- [ ] **Step 2: Run route tests and verify they fail**

Run: `npm run test:run -- src/app/api/account/addresses/route.test.ts src/app/api/account/addresses/[addressId]/route.test.ts`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement list/create handlers**

Validate the database session first. Parse JSON with `normalizeAddress`; translate `ZodError` into field errors; call the owner-scoped repository using only `session.user.id`. Return `Cache-Control: no-store` on authenticated responses.

- [ ] **Step 4: Implement update/delete handlers**

Use the route `addressId`, current user ID, and owner-scoped repository methods. Return `404` for both missing and foreign-owned IDs so ownership is not disclosed.

- [ ] **Step 5: Run route and security verification**

Run: `npm run test:run -- src/app/api/account/addresses && npm run lint && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the address API**

```bash
git add src/app/api/account/addresses
git commit -m "feat: add authorized saved-address API"
```

---

### Task 7: Shared address form and saved-address management

**Files:**
- Create: `src/components/address-form.tsx`
- Create: `src/components/address-form.test.tsx`
- Create: `src/components/saved-addresses.tsx`
- Create: `src/components/saved-addresses.test.tsx`
- Create: `src/app/account/addresses/page.tsx`
- Modify: `src/app/account/page.tsx`
- Modify: `src/components/storefront.module.css`

**Interfaces:**
- Produces: `<AddressForm value onChange errors disabled />` reusable later by checkout billing and delivery addresses.
- Produces: `<SavedAddresses initialAddresses />` for list/create/edit/delete.
- Consumes: Task 6 JSON contracts.

- [ ] **Step 1: Write failing country-switching form tests**

Verify country appears first, NZ renders a free-text `Region / city`, AU renders a state selector, selecting AU clears an incompatible NZ region, both use four-character numeric postcode input, labels remain associated, and all controls meet the existing minimum control height.

```tsx
await user.selectOptions(screen.getByLabelText("Country"), "AU");
expect(screen.getByLabelText("State / territory")).toHaveValue("");
expect(screen.getByLabelText("Postcode")).toHaveAttribute("inputMode", "numeric");
```

- [ ] **Step 2: Write failing saved-address interaction tests**

Test initial rendering, create, edit, cancel, delete confirmation, API error preservation, pending button state, and an empty state. The component must not optimistically remove an address before a successful delete response.

- [ ] **Step 3: Run component tests and verify they fail**

Run: `npm run test:run -- src/components/address-form.test.tsx src/components/saved-addresses.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 4: Implement the reusable address form**

Render the exact domain fields. Keep state in the parent. On country change, set `region` to `""` and retain street/suburb only after they are revalidated on submit. Render Australian regions from `AUSTRALIAN_REGIONS`; do not duplicate the list in React code.

- [ ] **Step 5: Implement saved-address management**

Fetch only through Task 6 routes. Parse response status before JSON. Surface field errors next to their controls and general errors in an `aria-live="polite"` region. Keep a single edit form open at a time.

- [ ] **Step 6: Protect and render account pages server-side**

Both `/account` and `/account/addresses` call `requireSession()` before reading
data and use `redirect("/account/sign-in")` when unauthenticated. `/account`
replaces the temporary account copy with links to Saved addresses and the
upcoming Orders area; it does not claim that order tracking already works.

- [ ] **Step 7: Apply existing visual tokens and responsive rules**

Use the current typography, spacing, borders, button system, focus states, and breakpoints from `storefront.module.css`. At narrow widths all fields are one column; at wider widths only country/building, region/postcode, and phone/email may pair. Do not add cards inside cards.

- [ ] **Step 8: Run full phase verification**

Run:

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
git diff --check
```

Expected: all existing and new checks PASS, proving the account work did not regress catalogue, pricing, urgent fees, upload, cart, header, or footer behavior.

- [ ] **Step 9: Commit the customer account and address UI**

```bash
git add src/components/address-form* src/components/saved-addresses* src/app/account src/components/storefront.module.css
git commit -m "feat: add customer saved-address management"
```

---

## Phase Acceptance Gate

Before starting live shipping and checkout persistence:

- [ ] Register a new account through `/account/register` and confirm a database-backed session.
- [ ] Sign out and sign back in through `/account/sign-in`.
- [ ] Create, edit, and delete one New Zealand and one Australian address.
- [ ] Confirm an authenticated user cannot retrieve another user's address by ID.
- [ ] Confirm country switching clears incompatible region values.
- [ ] Confirm NZ and AU phone numbers are stored in international format.
- [ ] Confirm invalid Australian state and invalid four-digit postcode are rejected server-side.
- [ ] Confirm `/account` and `/account/addresses` redirect unauthenticated visitors.
- [ ] Confirm existing guest cart and product configuration remain functional without account creation.
- [ ] Record the exact migration command and test database used without recording credentials.

## Following Plans

After this gate passes, create and execute these separate plans in order:

1. `checkout-live-shipping-orders`: package registry, shared checkout address instances, provider-neutral suggestions, GoSweetSpot quotes, checkout sessions, server repricing, and immutable orders.
2. `stripe-afterpay-zip-payments`: payment adapter contract, Stripe PaymentIntents, Afterpay and Zip redirects, signed callbacks, idempotency, reconciliation, and payment-state UI.

## Primary References

- Better Auth Next.js integration: <https://better-auth.com/docs/integrations/next>
- Better Auth Drizzle adapter: <https://better-auth.com/docs/adapters/drizzle>
- Better Auth CLI: <https://better-auth.com/docs/concepts/cli>
- Drizzle PostgreSQL: <https://orm.drizzle.team/docs/get-started-postgresql>
