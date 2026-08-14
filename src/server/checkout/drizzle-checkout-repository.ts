import { and, eq, gt, inArray, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import { normalizeAddress } from "@/domain/address/schema";
import type { getDatabase } from "@/server/db/client";
import {
  checkoutSessions,
  checkoutUploads,
  shippingQuotes,
} from "@/server/db/schema";
import type {
  CheckoutStateRepository,
  ReviewedPaymentCheckoutRepository,
} from "./checkout-repository";

type Database = ReturnType<typeof getDatabase>;

class StaleCheckoutVersionError extends Error {}

export function createDrizzleCheckoutRepository(
  database: Database,
): CheckoutStateRepository & ReviewedPaymentCheckoutRepository {
  return {
    async findActiveSessionByTokenDigest(tokenDigest, now) {
      const [session] = await database
        .select()
        .from(checkoutSessions)
        .where(
          and(
            eq(checkoutSessions.tokenDigest, tokenDigest),
            gt(checkoutSessions.expiresAt, now),
            isNull(checkoutSessions.completedAt),
          ),
        )
        .limit(1);
      return session ?? null;
    },

    async createSession(input) {
      const [session] = await database
        .insert(checkoutSessions)
        .values(input)
        .returning();
      return session;
    },

    async deleteEmptySession(sessionId) {
      const deleted = await database
        .delete(checkoutSessions)
        .where(
          and(
            eq(checkoutSessions.id, sessionId),
            notExists(
              database
                .select({ id: checkoutUploads.id })
                .from(checkoutUploads)
                .where(eq(checkoutUploads.checkoutSessionId, sessionId)),
            ),
          ),
        )
        .returning({ id: checkoutSessions.id });
      return deleted.length > 0;
    },

    async createUpload(input) {
      const [upload] = await database
        .insert(checkoutUploads)
        .values(input)
        .returning();
      return upload;
    },

    async findOwnedUploadIds(sessionId, uploadIds) {
      if (uploadIds.length === 0) return [];
      const uploads = await database
        .select({ id: checkoutUploads.id })
        .from(checkoutUploads)
        .where(
          and(
            eq(checkoutUploads.checkoutSessionId, sessionId),
            inArray(checkoutUploads.id, uploadIds),
            isNull(checkoutUploads.cleanupClaimedAt),
          ),
        );
      return uploads.map(({ id }) => id);
    },

    async saveCheckoutState(sessionId, input) {
      const changed = or(
        sql`${checkoutSessions.cartDigest} IS DISTINCT FROM ${input.cartDigest}`,
        sql`${checkoutSessions.cartSnapshot} IS DISTINCT FROM ${input.cartSnapshot}`,
        sql`${checkoutSessions.billingAddress} IS DISTINCT FROM ${input.billingAddress}`,
        sql`${checkoutSessions.deliveryAddress} IS DISTINCT FROM ${input.deliveryAddress}`,
        sql`${checkoutSessions.deliveryMethod} IS DISTINCT FROM ${input.deliveryMethod}`,
      );
      const [updated] = await database
        .update(checkoutSessions)
        .set({
          ...input,
          version: sql`${checkoutSessions.version} + 1`,
          selectedShippingQuoteId: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(checkoutSessions.id, sessionId),
          isNull(checkoutSessions.completedAt),
          changed,
        ))
        .returning();
      if (updated) return updated;

      const [current] = await database
        .select()
        .from(checkoutSessions)
        .where(and(
          eq(checkoutSessions.id, sessionId),
          isNull(checkoutSessions.completedAt),
        ))
        .limit(1);
      return current ?? null;
    },

    async getCheckoutState(sessionId) {
      const [session] = await database
        .select()
        .from(checkoutSessions)
        .where(eq(checkoutSessions.id, sessionId))
        .limit(1);
      return session ?? null;
    },

    async findReviewedPaymentContext(input) {
      const [row] = await database
        .select({ session: checkoutSessions, quote: shippingQuotes })
        .from(checkoutSessions)
        .leftJoin(
          shippingQuotes,
          and(
            eq(shippingQuotes.checkoutSessionId, checkoutSessions.id),
            eq(shippingQuotes.id, checkoutSessions.selectedShippingQuoteId),
          ),
        )
        .where(and(
          eq(checkoutSessions.id, input.sessionId),
          eq(checkoutSessions.version, input.checkoutVersion),
          eq(checkoutSessions.cartDigest, input.cartDigest),
          isNull(checkoutSessions.completedAt),
          sql`${checkoutSessions.expiresAt} > clock_timestamp()`,
          or(
            and(
              eq(checkoutSessions.deliveryMethod, "pickup"),
              isNull(checkoutSessions.selectedShippingQuoteId),
            ),
            and(
              eq(checkoutSessions.deliveryMethod, "post"),
              isNotNull(checkoutSessions.selectedShippingQuoteId),
              eq(shippingQuotes.currency, "NZD"),
              gt(shippingQuotes.amountInclGstCents, 0),
              sql`${shippingQuotes.expiresAt} > clock_timestamp()`,
            ),
          ),
        ))
        .limit(1);
      if (
        !row?.session.cartSnapshot ||
        row.session.cartSnapshot.cartDigest !== input.cartDigest ||
        !row.session.billingAddress ||
        !row.session.deliveryAddress
      ) return null;

      try {
        const billingAddress = normalizeAddress(row.session.billingAddress);
        const deliveryAddress = normalizeAddress(row.session.deliveryAddress);
        const shippingCents = row.session.deliveryMethod === "post"
          ? row.quote?.amountInclGstCents
          : 0;
        if (!Number.isSafeInteger(shippingCents) || Number(shippingCents) < 0) {
          return null;
        }
        const amountCents = row.session.cartSnapshot.totalInclGstCents + Number(shippingCents);
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
        return Object.freeze({
          amountCents,
          currency: "NZD" as const,
          customer: Object.freeze({
            fullName: billingAddress.fullName,
            email: billingAddress.email,
            phone: billingAddress.phone,
          }),
          billingAddress,
          deliveryAddress,
        });
      } catch {
        return null;
      }
    },

    async clearSelectedShippingQuote(sessionId, expectedVersion) {
      const updated = await database
        .update(checkoutSessions)
        .set({ selectedShippingQuoteId: null, updatedAt: new Date() })
        .where(
          and(
            eq(checkoutSessions.id, sessionId),
            eq(checkoutSessions.version, expectedVersion),
            isNull(checkoutSessions.completedAt),
          ),
        )
        .returning({ id: checkoutSessions.id });
      return updated.length > 0;
    },

    async persistAndSelectShippingQuote(input) {
      try {
        return await database.transaction(async (transaction) => {
          const [quote] = await transaction
            .insert(shippingQuotes)
            .values({
              checkoutSessionId: input.sessionId,
              requestDigest: input.requestDigest,
              ...input.quote,
            })
            .onConflictDoUpdate({
              target: [
                shippingQuotes.checkoutSessionId,
                shippingQuotes.provider,
                shippingQuotes.providerReference,
              ],
              set: {
                requestDigest: input.requestDigest,
                serviceCode: input.quote.serviceCode,
                serviceName: input.quote.serviceName,
                amountExGstCents: input.quote.amountExGstCents,
                gstCents: input.quote.gstCents,
                amountInclGstCents: input.quote.amountInclGstCents,
                rawResponseHash: input.quote.rawResponseHash,
                isTest: input.quote.isTest,
                expiresAt: input.quote.expiresAt,
              },
            })
            .returning();

          const selected = await transaction
            .update(checkoutSessions)
            .set({ selectedShippingQuoteId: quote.id, updatedAt: new Date() })
            .where(
              and(
                eq(checkoutSessions.id, input.sessionId),
                eq(checkoutSessions.version, input.expectedVersion),
                isNull(checkoutSessions.completedAt),
              ),
            )
            .returning({ id: checkoutSessions.id });
          if (selected.length === 0) throw new StaleCheckoutVersionError();
          return quote;
        });
      } catch (error) {
        if (error instanceof StaleCheckoutVersionError) return null;
        throw error;
      }
    },
  };
}
