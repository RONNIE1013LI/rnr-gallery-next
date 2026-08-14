import { desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { orderAddresses, orders, user } from "@/server/db/schema";

type Database = ReturnType<typeof getDatabase>;

function positivePage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export type AdminCustomerListItem = Readonly<{
  key: string;
  accountId: string | null;
  name: string;
  email: string;
  registered: boolean;
  emailVerified: boolean;
  phone: string | null;
  country: "NZ" | "AU" | null;
  defaultAddress: string | null;
  orderCount: number;
  paidSpentInclGstCents: number;
  lastOrderAt: Date | string | null;
}>;

function databaseDate(value: Date | string | null) {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

type AdminCustomerDatabaseRow = Readonly<{
  key: string;
  accountId: string | null;
  name: string;
  email: string;
  registered: boolean;
  emailVerified: boolean;
  phone: string | null;
  country: "NZ" | "AU" | null;
  defaultAddress: string | null;
  orderCount: number | string;
  paidSpentInclGstCents: number | string;
  lastOrderAt: Date | null;
}>;

function adminCustomerRowsSql() {
  return sql`
    with customer_accounts as (
      select
        lower(${user.email}) as email_key,
        ${user.id} as account_id,
        ${user.name} as name,
        ${user.email} as email,
        ${user.emailVerified} as email_verified
      from ${user}
      where ${user.role} = 'customer'
    ), order_groups as (
      select
        lower(${orders.customerEmail}) as email_key,
        max(${orders.customerId}) filter (where ${orders.customerId} is not null) as account_id,
        min(${orders.customerEmail}) as email,
        count(*)::int as order_count,
        coalesce(sum(${orders.totalInclGstCents}) filter (where ${orders.paymentStatus} = 'paid'), 0) as paid_spent_incl_gst_cents,
        max(${orders.createdAt}) as last_order_at
      from ${orders}
      group by lower(${orders.customerEmail})
    ), latest_delivery as (
      select distinct on (lower(${orders.customerEmail}))
        lower(${orders.customerEmail}) as email_key,
        ${orderAddresses.fullName} as full_name,
        ${orderAddresses.phone} as phone,
        ${orderAddresses.country} as country,
        ${orderAddresses.building} as building,
        ${orderAddresses.street} as street,
        ${orderAddresses.suburb} as suburb,
        ${orderAddresses.region} as region,
        ${orderAddresses.postcode} as postcode
      from ${orders}
      inner join ${orderAddresses}
        on ${orderAddresses.orderId} = ${orders.id}
        and ${orderAddresses.kind} = 'delivery'
      order by lower(${orders.customerEmail}), ${orders.createdAt} desc
    ), customer_rows as (
      select
        coalesce(a.account_id, g.account_id, coalesce(a.email, g.email)) as key,
        coalesce(a.account_id, g.account_id) as account_id,
        coalesce(nullif(a.name, ''), d.full_name, a.email, g.email) as name,
        coalesce(a.email, g.email) as email,
        (a.account_id is not null or g.account_id is not null) as registered,
        coalesce(a.email_verified, false) as email_verified,
        d.phone,
        d.country,
        nullif(concat_ws(', ', nullif(d.building, ''), nullif(d.street, ''), nullif(d.suburb, ''), nullif(d.region, ''), nullif(d.postcode, ''), nullif(d.country, '')), '') as default_address,
        coalesce(g.order_count, 0) as order_count,
        coalesce(g.paid_spent_incl_gst_cents, 0) as paid_spent_incl_gst_cents,
        g.last_order_at
      from customer_accounts a
      full outer join order_groups g on g.email_key = a.email_key
      left join latest_delivery d on d.email_key = coalesce(a.email_key, g.email_key)
    )
  `;
}

export async function listAdminCustomers(
  database: Database,
  params: Readonly<Record<string, string | string[] | undefined>>,
) {
  const page = positivePage(params.page);
  const pageSize = 30;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = rawQuery?.trim().toLowerCase().slice(0, 320) ?? "";
  const filterSql = query
    ? sql`where lower(concat_ws(' ', name, email, coalesce(phone, ''))) like ${`%${query}%`}`
    : sql``;
  const countResult = await database.execute<{ total: number | string }>(sql`
    ${adminCustomerRowsSql()}
    select count(*)::int as total from customer_rows ${filterSql}
  `);
  const total = Number(countResult.rows[0]?.total ?? 0);
  const pageCount = Math.ceil(total / pageSize);
  const safePage = pageCount ? Math.min(page, pageCount) : 1;
  const rowsResult = await database.execute<AdminCustomerDatabaseRow>(sql`
    ${adminCustomerRowsSql()}
    select
      key,
      account_id as "accountId",
      name,
      email,
      registered,
      email_verified as "emailVerified",
      phone,
      country,
      default_address as "defaultAddress",
      order_count as "orderCount",
      paid_spent_incl_gst_cents as "paidSpentInclGstCents",
      last_order_at as "lastOrderAt"
    from customer_rows
    ${filterSql}
    order by last_order_at desc nulls last, email asc
    limit ${pageSize}
    offset ${(safePage - 1) * pageSize}
  `);
  const items = rowsResult.rows.map((row) => Object.freeze({
    ...row,
    orderCount: Number(row.orderCount),
    paidSpentInclGstCents: Number(row.paidSpentInclGstCents),
    lastOrderAt: databaseDate(row.lastOrderAt),
  }));
  return Object.freeze({
    items: Object.freeze(items),
    total,
    page: safePage,
    pageSize,
    pageCount,
  });
}

export async function getAdminCustomerDetail(database: Database, customerKey: string) {
  const decoded = decodeURIComponent(customerKey);
  if (!decoded || decoded.length > 320) return null;
  const [account] = await database.select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, createdAt: user.createdAt })
    .from(user).where(eq(user.id, decoded)).limit(1);
  const email = account?.email ?? decoded;
  if (!email.includes("@")) return null;
  const customerOrders = await database.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    totalInclGstCents: orders.totalInclGstCents,
    paymentStatus: orders.paymentStatus,
    fulfilmentStatus: orders.fulfilmentStatus,
    createdAt: orders.createdAt,
  }).from(orders).where(sql`lower(${orders.customerEmail}) = lower(${email})`).orderBy(desc(orders.createdAt));
  if (!account && customerOrders.length === 0) return null;
  const addresses = await database.select({
    kind: orderAddresses.kind,
    fullName: orderAddresses.fullName,
    building: orderAddresses.building,
    street: orderAddresses.street,
    suburb: orderAddresses.suburb,
    region: orderAddresses.region,
    postcode: orderAddresses.postcode,
    country: orderAddresses.country,
    phone: orderAddresses.phone,
  }).from(orderAddresses).innerJoin(orders, eq(orders.id, orderAddresses.orderId))
    .where(sql`lower(${orders.customerEmail}) = lower(${email})`)
    .orderBy(desc(orders.createdAt)).limit(8);
  return Object.freeze({
    account: account ? Object.freeze(account) : null,
    name: account?.name ?? addresses[0]?.fullName ?? email,
    email,
    orders: Object.freeze(customerOrders),
    addresses: Object.freeze(addresses),
  });
}
