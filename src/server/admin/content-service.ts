import { eq } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { adminAuditLogs, contentEntries, user } from "@/server/db/schema";
import { buildAuditRecord } from "./audit-service";

export const contentDefinitions = Object.freeze([
  { key: "home.hero.eyebrow", group: "Homepage", label: "Hero eyebrow", description: "Short line above the homepage title.", maxLength: 80, multiline: false, defaultValue: "Made around what matters" },
  { key: "home.hero.title", group: "Homepage", label: "Hero title", description: "Primary homepage heading.", maxLength: 200, multiline: false, defaultValue: "Art made from your story." },
  { key: "home.hero.subtitle", group: "Homepage", label: "Hero subtitle", description: "Homepage introductory message.", maxLength: 400, multiline: true, defaultValue: "Turn meaningful photos into personal canvas and banner artwork, created with care in New Zealand." },
  { key: "home.hero.primary_cta", group: "Homepage", label: "Primary CTA", description: "Main homepage action label.", maxLength: 60, multiline: false, defaultValue: "Create your artwork" },
  { key: "home.hero.secondary_cta", group: "Homepage", label: "Secondary CTA", description: "Gallery action label.", maxLength: 60, multiline: false, defaultValue: "Explore the gallery" },
  { key: "home.process.eyebrow", group: "Homepage", label: "Process eyebrow", description: "Short label above the homepage process.", maxLength: 80, multiline: false, defaultValue: "How it works" },
  { key: "home.process.title", group: "Homepage", label: "Process title", description: "Homepage process-section heading.", maxLength: 180, multiline: false, defaultValue: "Simple steps. Personal results." },
  { key: "footer.tagline", group: "Footer & contact", label: "Footer tagline", description: "Business summary in the global footer.", maxLength: 240, multiline: true, defaultValue: "Custom canvas, banners and print solutions, crafted with care in New Zealand." },
  { key: "contact.email", group: "Footer & contact", label: "Customer service email", description: "Public customer-service email address.", maxLength: 320, multiline: false, defaultValue: "customerservice@rnrgallery.com" },
  { key: "contact.phone", group: "Footer & contact", label: "Customer service phone", description: "Public customer-service phone number.", maxLength: 40, multiline: false, defaultValue: "+64 21 023 48948" },
  { key: "how_it_works.intro", group: "How it works", label: "Process introduction", description: "Opening sentence on the process page.", maxLength: 400, multiline: true, defaultValue: "From source photo to finished artwork." },
  { key: "faq.intro", group: "FAQ", label: "FAQ introduction", description: "Opening text for frequently asked questions.", maxLength: 500, multiline: true, defaultValue: "Answers to common questions about ordering, artwork approval, production and delivery." },
  { key: "faq.revisions", group: "FAQ", label: "Revision answer", description: "Plain-text answer describing artwork revisions.", maxLength: 1200, multiline: true, defaultValue: "We offer up to two free revision rounds based on the original photo. Please group requested changes together." },
  { key: "faq.photos", group: "FAQ", label: "Photo submission answer", description: "Plain-text answer describing how customers can send photos.", maxLength: 1200, multiline: true, defaultValue: "Photos can be uploaded while ordering or sent afterwards by Messenger, email or WhatsApp." },
  { key: "delivery.production_time", group: "Delivery & production", label: "Production time", description: "Default production-time statement.", maxLength: 500, multiline: true, defaultValue: "All orders have a production time of 5 business days from the date the order is placed." },
  { key: "delivery.nz_time", group: "Delivery & production", label: "NZ delivery time", description: "Estimated NZ delivery after production.", maxLength: 240, multiline: true, defaultValue: "New Zealand: 2–3 business days after production." },
  { key: "delivery.au_time", group: "Delivery & production", label: "AU delivery time", description: "Estimated AU standard delivery after production.", maxLength: 240, multiline: true, defaultValue: "Australia (Standard Delivery): approximately 5 business days after production." },
  { key: "delivery.urgent_notice", group: "Delivery & production", label: "Urgent-order notice", description: "Instruction for customers who need an urgent order.", maxLength: 500, multiline: true, defaultValue: "If your order is urgent, clearly let us know when placing it so we can arrange it accordingly and avoid delays." },
  { key: "policy.refund", group: "Policies", label: "Refund policy summary", description: "Short operational refund summary.", maxLength: 1200, multiline: true, defaultValue: "The deposit becomes non-refundable once the design or painting draft is completed." },
  { key: "policy.revisions", group: "Policies", label: "Revision policy", description: "Artwork revision terms.", maxLength: 1200, multiline: true, defaultValue: "Up to two revisions are free. Please list requested changes together. Further revision rounds may incur a $30 fee, and changing to a different source photo costs $25." },
  { key: "policy.privacy_intro", group: "Policies", label: "Privacy introduction", description: "Approved introductory privacy summary. The complete legal policy remains in the versioned page.", maxLength: 1200, multiline: true, defaultValue: "This privacy statement explains how R&R Gallery handles personal information when you browse our website, contact us, submit photos or artwork, create an account, or place an order." },
  { key: "upload.instructions", group: "Orders", label: "Photo upload instructions", description: "Photo-submission guidance used during ordering.", maxLength: 800, multiline: true, defaultValue: "Upload clear original photos while ordering, or send them after checkout by Messenger, email or WhatsApp." },
  { key: "checkout.notice", group: "Orders", label: "Checkout notice", description: "Operational notice shown before placing an order.", maxLength: 800, multiline: true, defaultValue: "Review your items, address, delivery option and total before placing the order." },
  { key: "order.confirmation_notice", group: "Orders", label: "Order confirmation notice", description: "Message shown after an order is created.", maxLength: 800, multiline: true, defaultValue: "We will contact you if we need any additional files or details before preparing your draft." },
] as const);

export type ContentKey = typeof contentDefinitions[number]["key"];
type Database = ReturnType<typeof getDatabase>;

export class ContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentValidationError";
  }
}

function definitionFor(key: string) {
  return contentDefinitions.find((definition) => definition.key === key);
}

export function parseContentValue(key: string, input: unknown): string {
  const definition = definitionFor(key);
  if (!definition) throw new ContentValidationError("Unknown content field");
  if (typeof input !== "string") throw new ContentValidationError("Content must be text");
  const value = input.trim();
  if (!value) throw new ContentValidationError(`${definition.label} is required`);
  if (value.length > definition.maxLength) throw new ContentValidationError(`${definition.label} is too long`);
  if (/[<>]/.test(value)) throw new ContentValidationError("Plain text only");
  return value;
}

export function resolvePublishedContent<K extends ContentKey>(
  rows: readonly Readonly<{ key: string; publishedValue: string | null }>[] ,
  keys: readonly K[],
): Readonly<Record<K, string>> {
  return Object.freeze(Object.fromEntries(keys.map((key) => {
    const definition = definitionFor(key)!;
    const row = rows.find((candidate) => candidate.key === key);
    return [key, row?.publishedValue || definition.defaultValue];
  })) as Record<K, string>);
}

export async function listAdminContent(database: Database) {
  const rows = await database
    .select({
      key: contentEntries.key,
      draftValue: contentEntries.draftValue,
      publishedValue: contentEntries.publishedValue,
      updatedAt: contentEntries.updatedAt,
      updatedByEmail: user.email,
    })
    .from(contentEntries)
    .leftJoin(user, eq(user.id, contentEntries.draftUpdatedBy));

  return Object.freeze(contentDefinitions.map((definition) => {
    const row = rows.find((candidate) => candidate.key === definition.key);
    return Object.freeze({
      ...definition,
      draftValue: row?.draftValue ?? definition.defaultValue,
      publishedValue: row?.publishedValue ?? definition.defaultValue,
      updatedAt: row?.updatedAt ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
    });
  }));
}

export async function getPublicContent<K extends ContentKey>(
  database: Database,
  keys: readonly K[],
): Promise<Readonly<Record<K, string>>> {
  try {
    const rows = await database
      .select({ key: contentEntries.key, publishedValue: contentEntries.publishedValue })
      .from(contentEntries);
    return resolvePublishedContent(rows, keys);
  } catch {
    return resolvePublishedContent([], keys);
  }
}

type ContentActor = Readonly<{ userId: string; email: string }>;
type ContentMutationInput = Readonly<{
  key: string;
  value: unknown;
  idempotencyKey: string;
  requestSource?: string;
}>;

function validIdempotencyKey(value: string) {
  if (typeof value !== "string" || value.trim().length < 8 || value.length > 255) {
    throw new ContentValidationError("Invalid idempotency key");
  }
  return value.trim();
}

export async function saveContentDraft(
  database: Database,
  actor: ContentActor,
  input: ContentMutationInput,
) {
  const definition = definitionFor(input.key);
  if (!definition) throw new ContentValidationError("Unknown content field");
  const value = parseContentValue(input.key, input.value);
  const idempotencyKey = validIdempotencyKey(input.idempotencyKey);
  return database.transaction(async (transaction) => {
    const [audit] = await transaction.insert(adminAuditLogs).values(buildAuditRecord({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: "content.draft.saved",
      resourceType: "content",
      resourceId: input.key,
      afterSummary: { key: input.key, valueLength: value.length },
      requestSource: input.requestSource,
      result: "success",
      idempotencyKey,
    })).onConflictDoNothing().returning({ id: adminAuditLogs.id });
    if (!audit) return "duplicate" as const;

    await transaction.insert(contentEntries).values({
      key: definition.key,
      groupName: definition.group,
      label: definition.label,
      draftValue: value,
      draftUpdatedBy: actor.userId,
    }).onConflictDoUpdate({
      target: contentEntries.key,
      set: { draftValue: value, draftUpdatedBy: actor.userId, updatedAt: new Date() },
    });
    return "saved" as const;
  });
}

export async function publishContent(
  database: Database,
  actor: ContentActor,
  input: ContentMutationInput,
) {
  const definition = definitionFor(input.key);
  if (!definition) throw new ContentValidationError("Unknown content field");
  const value = parseContentValue(input.key, input.value);
  const idempotencyKey = validIdempotencyKey(input.idempotencyKey);
  return database.transaction(async (transaction) => {
    const [current] = await transaction
      .select({ publishedValue: contentEntries.publishedValue })
      .from(contentEntries)
      .where(eq(contentEntries.key, input.key))
      .limit(1);
    const [audit] = await transaction.insert(adminAuditLogs).values(buildAuditRecord({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: "content.published",
      resourceType: "content",
      resourceId: input.key,
      beforeSummary: { value: current?.publishedValue ?? definition.defaultValue },
      afterSummary: { value },
      requestSource: input.requestSource,
      result: "success",
      idempotencyKey,
    })).onConflictDoNothing().returning({ id: adminAuditLogs.id });
    if (!audit) return "duplicate" as const;

    const now = new Date();
    await transaction.insert(contentEntries).values({
      key: definition.key,
      groupName: definition.group,
      label: definition.label,
      draftValue: value,
      publishedValue: value,
      draftUpdatedBy: actor.userId,
      publishedBy: actor.userId,
      publishedAt: now,
    }).onConflictDoUpdate({
      target: contentEntries.key,
      set: {
        draftValue: value,
        publishedValue: value,
        draftUpdatedBy: actor.userId,
        publishedBy: actor.userId,
        publishedAt: now,
        updatedAt: now,
      },
    });
    return "published" as const;
  });
}
