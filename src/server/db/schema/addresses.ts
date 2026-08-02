import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { SupportedCountry } from "@/domain/address/types";
import { user } from "./auth";

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    country: text("country").$type<SupportedCountry>().notNull(),
    fullName: text("full_name").notNull(),
    building: text("building").notNull(),
    street: text("street").notNull(),
    suburb: text("suburb").notNull(),
    region: text("region").notNull(),
    postcode: text("postcode").notNull(),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("customer_addresses_owner_id_idx").on(table.ownerId),
  ],
);
