import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { session, user } from "./auth";
import type { StaffRole } from "@/server/auth/staff-security-policy";

export const twoFactor = pgTable("staff_two_factor", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified").default(false).notNull(),
  failedVerificationCount: integer("failed_verification_count").default(0).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
}, (table) => [uniqueIndex("staff_two_factor_user_unique").on(table.userId)]);

export const passkey = pgTable("staff_passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  aaguid: text("aaguid"),
}, (table) => [uniqueIndex("staff_passkey_credential_unique").on(table.credentialID), index("staff_passkey_user_idx").on(table.userId)]);

export const staffSecurity = pgTable("staff_security", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "restrict" }),
  role: text("role").$type<StaffRole>().notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  fallbackVerifiedAt: timestamp("fallback_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [check("staff_security_role_valid", sql`${table.role} in ('owner','admin','staff','customer_service','designer','production','temporary')`)]);

export const staffSessionSecurity = pgTable("staff_session_security", {
  sessionId: text("session_id").primaryKey().references(() => session.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  mfaAt: timestamp("mfa_at", { withTimezone: true }),
  elevatedAt: timestamp("elevated_at", { withTimezone: true }),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
  factor: text("factor").$type<"passkey" | "totp" | "recovery">(),
}, (table) => [index("staff_session_security_user_idx").on(table.userId)]);

export const staffSecurityPolicy = pgTable("staff_security_policy", {
  id: text("id").primaryKey(),
  rolloutAt: timestamp("rollout_at", { withTimezone: true }).notNull(),
  enforcedAt: timestamp("enforced_at", { withTimezone: true }),
  activatedBy: text("activated_by").notNull().references(() => user.id, { onDelete: "restrict" }),
}, (table) => [check("staff_security_policy_singleton", sql`${table.id} = 'primary'`)]);
