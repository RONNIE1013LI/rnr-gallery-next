import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutSessions, shippingQuotes, user } from "@/server/db/schema";
import { normalizeAddress } from "@/domain/address/schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import {
  assertOwnedUploadReferences,
  UnownedUploadReferenceError,
} from "./checkout-repository";
import { createDrizzleCheckoutRepository } from "./drizzle-checkout-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const suffix = randomUUID();
const customerIds = [`checkout-owner-a-${suffix}`, `checkout-owner-b-${suffix}`];
const sessionIds: string[] = [];
const pool = new Pool({ connectionString: testDatabaseUrl });
const database = drizzle(pool);
const repository = createDrizzleCheckoutRepository(database);
const expiresAt = new Date("2099-01-01T00:00:00.000Z");

describe("Drizzle checkout repository", () => {
  beforeAll(async () => {
    await database.insert(user).values([
      { id: customerIds[0], name: "Checkout A", email: `a-${suffix}@example.test` },
      { id: customerIds[1], name: "Checkout B", email: `b-${suffix}@example.test` },
    ]);
  });

  afterAll(async () => {
    if (sessionIds.length) {
      await database
        .delete(checkoutSessions)
        .where(inArray(checkoutSessions.id, sessionIds));
    }
    await database.delete(user).where(inArray(user.id, customerIds));
    await pool.end();
  });

  it("finds only active token digests and deletes a newly-created empty session", async () => {
    const guest = await repository.createSession({
      tokenDigest: `guest-${suffix}`,
      customerId: null,
      expiresAt,
    });
    sessionIds.push(guest.id);

    expect(
      await repository.findActiveSessionByTokenDigest(
        `guest-${suffix}`,
        new Date("2026-08-02T00:00:00.000Z"),
      ),
    ).toMatchObject({ id: guest.id, customerId: null });

    expect(await repository.deleteEmptySession(guest.id)).toBe(true);
    expect(
      await repository.findActiveSessionByTokenDigest(
        `guest-${suffix}`,
        new Date("2026-08-02T00:00:00.000Z"),
      ),
    ).toBeNull();

    const expired = await repository.createSession({
      tokenDigest: `expired-${suffix}`,
      customerId: null,
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    sessionIds.push(expired.id);
    expect(
      await repository.findActiveSessionByTokenDigest(
        `expired-${suffix}`,
        new Date("2026-08-02T00:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("accepts owned upload IDs and rejects cross-session references", async () => {
    const first = await repository.createSession({
      tokenDigest: `first-${suffix}`,
      customerId: null,
      expiresAt,
    });
    const second = await repository.createSession({
      tokenDigest: `second-${suffix}`,
      customerId: null,
      expiresAt,
    });
    sessionIds.push(first.id, second.id);
    const firstUploadId = randomUUID();
    const secondUploadId = randomUUID();

    await repository.createUpload({
      id: firstUploadId,
      checkoutSessionId: first.id,
      storageKey: `${firstUploadId}.bin`,
      originalName: "first.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 10,
      sha256: "a".repeat(64),
    });
    await repository.createUpload({
      id: secondUploadId,
      checkoutSessionId: second.id,
      storageKey: `${secondUploadId}.bin`,
      originalName: "second.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 10,
      sha256: "b".repeat(64),
    });

    await expect(
      assertOwnedUploadReferences(repository, first.id, [firstUploadId]),
    ).resolves.toBeUndefined();
    expect(await repository.deleteEmptySession(first.id)).toBe(false);
    await expect(
      assertOwnedUploadReferences(repository, first.id, [secondUploadId]),
    ).rejects.toBeInstanceOf(UnownedUploadReferenceError);
  });

  it("versions changed checkout state, preserves identical state and selects only current quotes", async () => {
    const checkout = await repository.createSession({
      tokenDigest: `state-${suffix}`,
      customerId: null,
      expiresAt,
    });
    sessionIds.push(checkout.id);
    const cartSnapshot = repriceCart({
      version: 1,
      items: [{
        clientItemId: randomUUID(),
        productKey: "photo-print-canvas",
        sizeKey: "a4",
        orientation: "landscape",
        peoplePets: 0,
        photoSubmissionMethod: "later",
        designText: "Family",
        notes: "",
        neededDate: "2026-08-10",
        urgentServiceConfirmed: false,
        quantity: 1,
        uploadReferences: [],
      }],
    }, { now: new Date("2026-08-02T12:00:00.000Z") });
    const address = normalizeAddress({
      country: "NZ",
      fullName: "Aroha Ngata",
      building: "",
      street: "12 Queen Street",
      suburb: "Auckland Central",
      region: "Auckland",
      postcode: "1010",
      phone: "021 123 4567",
      email: "aroha@example.test",
    });
    const input = {
      cartDigest: cartSnapshot.cartDigest,
      cartSnapshot,
      billingAddress: address,
      deliveryAddress: address,
      deliveryMethod: "post" as const,
    };

    const first = await repository.saveCheckoutState(checkout.id, input);
    expect(first).toMatchObject({ version: 2, selectedShippingQuoteId: null });
    const quote = {
      provider: "local-test" as const,
      serviceCode: "test-post-nz",
      serviceName: "Test Post — not a live carrier rate",
      amountExGstCents: 2_000,
      gstCents: 300,
      amountInclGstCents: 2_300,
      currency: "NZD" as const,
      providerReference: `state-quote-${suffix}`,
      expiresAt: new Date("2099-01-01T00:15:00.000Z"),
      rawResponseHash: "d".repeat(64),
      isTest: true,
    };
    const selected = await repository.persistAndSelectShippingQuote({
      sessionId: checkout.id,
      expectedVersion: 2,
      requestDigest: "e".repeat(64),
      quote,
    });
    expect(selected).toMatchObject({ requestDigest: "e".repeat(64), ...quote });

    const unchanged = await repository.saveCheckoutState(checkout.id, input);
    expect(unchanged).toMatchObject({
      version: 2,
      selectedShippingQuoteId: selected!.id,
    });

    const changed = await repository.saveCheckoutState(checkout.id, {
      ...input,
      deliveryAddress: { ...address, postcode: "6011", region: "Wellington" },
    });
    expect(changed).toMatchObject({ version: 3, selectedShippingQuoteId: null });
    await expect(repository.persistAndSelectShippingQuote({
      sessionId: checkout.id,
      expectedVersion: 2,
      requestDigest: "f".repeat(64),
      quote,
    })).resolves.toBeNull();
    expect(await database
      .select({ requestDigest: shippingQuotes.requestDigest })
      .from(shippingQuotes)
      .where(eq(shippingQuotes.checkoutSessionId, checkout.id)))
      .toEqual([{ requestDigest: "e".repeat(64) }]);

    await expect(repository.persistAndSelectShippingQuote({
      sessionId: checkout.id,
      expectedVersion: 2,
      requestDigest: "1".repeat(64),
      quote: {
        ...quote,
        providerReference: `stale-new-quote-${suffix}`,
      },
    })).resolves.toBeNull();
    expect(await database
      .select({ requestDigest: shippingQuotes.requestDigest })
      .from(shippingQuotes)
      .where(eq(shippingQuotes.checkoutSessionId, checkout.id)))
      .toEqual([{ requestDigest: "e".repeat(64) }]);
    expect((await repository.getCheckoutState(checkout.id))?.selectedShippingQuoteId)
      .toBeNull();
  });

  it("loads an exact reviewed payment context with authoritative shipping", async () => {
    const checkout = await repository.createSession({
      tokenDigest: `payment-context-${suffix}`,
      customerId: null,
      expiresAt,
    });
    sessionIds.push(checkout.id);
    const cartSnapshot = repriceCart({
      version: 1,
      items: [{
        clientItemId: randomUUID(),
        productKey: "photo-print-canvas",
        sizeKey: "a4",
        orientation: "landscape",
        peoplePets: 0,
        photoSubmissionMethod: "later",
        designText: "Family",
        notes: "",
        neededDate: "2026-08-10",
        urgentServiceConfirmed: false,
        quantity: 1,
        uploadReferences: [],
      }],
    }, { now: new Date("2026-08-02T12:00:00.000Z") });
    const address = normalizeAddress({
      country: "NZ", fullName: "Aroha Ngata", building: "",
      street: "12 Queen Street", suburb: "Auckland Central", region: "Auckland",
      postcode: "1010", phone: "021 123 4567", email: "aroha@example.test",
    });
    const saved = await repository.saveCheckoutState(checkout.id, {
      cartDigest: cartSnapshot.cartDigest,
      cartSnapshot,
      billingAddress: address,
      deliveryAddress: address,
      deliveryMethod: "post",
    });
    const quote = await repository.persistAndSelectShippingQuote({
      sessionId: checkout.id,
      expectedVersion: saved!.version,
      requestDigest: "8".repeat(64),
      quote: {
        provider: "local-test", serviceCode: "test-post-nz", serviceName: "Test Post",
        amountExGstCents: 2_000, gstCents: 300, amountInclGstCents: 2_300,
        currency: "NZD", providerReference: `payment-context-${suffix}`,
        expiresAt: new Date("2099-01-01T00:15:00.000Z"),
        rawResponseHash: "9".repeat(64), isTest: true,
      },
    });

    await expect(repository.findReviewedPaymentContext({
      sessionId: checkout.id,
      checkoutVersion: saved!.version,
      cartDigest: cartSnapshot.cartDigest,
    })).resolves.toEqual({
      amountCents: cartSnapshot.totalInclGstCents + quote!.amountInclGstCents,
      currency: "NZD",
      customer: { fullName: address.fullName, email: address.email, phone: address.phone },
      billingAddress: address,
      deliveryAddress: address,
    });
    await expect(repository.findReviewedPaymentContext({
      sessionId: checkout.id,
      checkoutVersion: saved!.version + 1,
      cartDigest: cartSnapshot.cartDigest,
    })).resolves.toBeNull();
    await expect(repository.findReviewedPaymentContext({
      sessionId: checkout.id,
      checkoutVersion: saved!.version,
      cartDigest: "0".repeat(64),
    })).resolves.toBeNull();
    await database.update(shippingQuotes)
      .set({ expiresAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(shippingQuotes.id, quote!.id));
    await expect(repository.findReviewedPaymentContext({
      sessionId: checkout.id,
      checkoutVersion: saved!.version,
      cartDigest: cartSnapshot.cartDigest,
    })).resolves.toBeNull();
  });

  it("uses zero shipping only for a reviewed Pickup checkout", async () => {
    const checkout = await repository.createSession({
      tokenDigest: `pickup-payment-context-${suffix}`,
      customerId: null,
      expiresAt,
    });
    sessionIds.push(checkout.id);
    const cartSnapshot = repriceCart({
      version: 1,
      items: [{
        clientItemId: randomUUID(), productKey: "photo-print-canvas", sizeKey: "a4",
        orientation: "landscape", peoplePets: 0, photoSubmissionMethod: "later",
        designText: "Family", notes: "", neededDate: "2026-08-10",
        urgentServiceConfirmed: false, quantity: 1, uploadReferences: [],
      }],
    }, { now: new Date("2026-08-02T12:00:00.000Z") });
    const address = normalizeAddress({
      country: "NZ", fullName: "Aroha Ngata", building: "",
      street: "12 Queen Street", suburb: "Auckland Central", region: "Auckland",
      postcode: "1010", phone: "021 123 4567", email: "aroha@example.test",
    });
    const saved = await repository.saveCheckoutState(checkout.id, {
      cartDigest: cartSnapshot.cartDigest, cartSnapshot,
      billingAddress: address, deliveryAddress: address, deliveryMethod: "pickup",
    });

    await expect(repository.findReviewedPaymentContext({
      sessionId: checkout.id,
      checkoutVersion: saved!.version,
      cartDigest: cartSnapshot.cartDigest,
    })).resolves.toMatchObject({
      amountCents: cartSnapshot.totalInclGstCents,
      currency: "NZD",
    });
  });
});
