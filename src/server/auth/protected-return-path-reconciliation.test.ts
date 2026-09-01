import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { safeAuthReturnPath } from "./safe-return-path";

const appRoot = join(process.cwd(), "src/app");

const protectedPages = new Map<string, string>([
  ["src/app/account/addresses/page.tsx", "/account/addresses"],
  ["src/app/account/orders/[orderNumber]/page.tsx", "/account/orders/RNR-2026-ABC"],
  ["src/app/account/orders/page.tsx", "/account/orders"],
  ["src/app/admin/analytics/page.tsx", "/admin/analytics"],
  ["src/app/admin/audit/page.tsx", "/admin/audit"],
  ["src/app/admin/content/page.tsx", "/admin/content"],
  ["src/app/admin/customer-reviews/[reviewId]/page.tsx", "/admin/customer-reviews/review-id"],
  ["src/app/admin/customer-reviews/new/page.tsx", "/admin/customer-reviews/new"],
  ["src/app/admin/customer-reviews/page.tsx", "/admin/customer-reviews"],
  ["src/app/admin/customers/[customerKey]/page.tsx", "/admin/customers/customer-key"],
  ["src/app/admin/customers/page.tsx", "/admin/customers"],
  ["src/app/admin/design-gallery/[designId]/page.tsx", "/admin/design-gallery/design-id"],
  ["src/app/admin/design-gallery/new/page.tsx", "/admin/design-gallery/new"],
  ["src/app/admin/design-gallery/page.tsx", "/admin/design-gallery"],
  ["src/app/admin/jobs/[jobId]/page.tsx", "/admin/jobs/job-id"],
  ["src/app/admin/jobs/fields/page.tsx", "/admin/jobs/fields"],
  ["src/app/admin/jobs/new/page.tsx", "/admin/jobs/new"],
  ["src/app/admin/jobs/page.tsx", "/admin/jobs"],
  ["src/app/admin/jobs/report/page.tsx", "/admin/jobs/report"],
  ["src/app/admin/media/page.tsx", "/admin/media"],
  ["src/app/admin/orders/[orderId]/page.tsx", "/admin/orders/order-id"],
  ["src/app/admin/orders/page.tsx", "/admin/orders"],
  ["src/app/admin/page.tsx", "/admin"],
  ["src/app/admin/payment-requests/[requestId]/page.tsx", "/admin/payment-requests/request-id"],
  ["src/app/admin/payment-requests/new/page.tsx", "/admin/payment-requests/new"],
  ["src/app/admin/payment-requests/page.tsx", "/admin/payment-requests"],
  ["src/app/admin/products/page.tsx", "/admin/products"],
  ["src/app/admin/settings/advertising/page.tsx", "/admin/settings/advertising"],
  ["src/app/admin/settings/email-templates/page.tsx", "/admin/settings/email-templates"],
  ["src/app/admin/settings/notifications/page.tsx", "/admin/settings/notifications"],
  ["src/app/admin/settings/page.tsx", "/admin/settings"],
  ["src/app/admin/settings/payment/page.tsx", "/admin/settings/payment"],
  ["src/app/admin/settings/shipping/page.tsx", "/admin/settings/shipping"],
  ["src/app/admin/users/[userId]/page.tsx", "/admin/users/user-id"],
  ["src/app/admin/users/new/page.tsx", "/admin/users/new"],
  ["src/app/admin/users/page.tsx", "/admin/users"],
  ["src/app/forms/(portal)/jobs/[jobId]/page.tsx", "/order-system/jobs/job-id"],
  ["src/app/forms/(portal)/new/page.tsx", "/order-system/new"],
  ["src/app/forms/(portal)/page.tsx", "/order-system"],
  ["src/app/forms/(portal)/stats/page.tsx", "/order-system/stats"],
  ["src/app/reply-assistant/page.tsx", "/reply-assistant"],
]);

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(absolutePath);
    if (!/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [relative(process.cwd(), absolutePath)];
  });
}

function pageFilesUnder(relativeDirectory: string): string[] {
  return sourceFilesUnder(join(process.cwd(), relativeDirectory))
    .filter((file) => file.endsWith("/page.tsx") || file.endsWith("page.tsx"));
}

describe("protected return-path reconciliation", () => {
  it("requires every protected page to have an explicit approved return target", () => {
    const directAccountPages = pageFilesUnder("src/app/account").filter((file) =>
      readFileSync(join(process.cwd(), file), "utf8").includes("requireAccountPage("),
    );
    const discovered = [
      ...pageFilesUnder("src/app/admin"),
      ...pageFilesUnder("src/app/forms/(portal)"),
      ...pageFilesUnder("src/app/reply-assistant"),
      ...directAccountPages,
    ].sort();

    expect(discovered).toEqual([...protectedPages.keys()].sort());
    for (const returnPath of protectedPages.values()) {
      expect(safeAuthReturnPath(returnPath, "/invalid")).toBe(returnPath);
    }
  });

  it("fails when an auth-gated page or layout is added outside the reconciled route trees", () => {
    const gatedFiles = sourceFilesUnder(appRoot)
      .filter((file) => /\/(?:page|layout)\.tsx$/.test(file))
      .filter((file) => /require(?:Admin|Account|Forms)Page\(/.test(
        readFileSync(join(process.cwd(), file), "utf8"),
      ));
    const knownTrees = [
      "src/app/account/",
      "src/app/admin/",
      "src/app/forms/(portal)/",
      "src/app/reply-assistant/",
    ];

    expect(gatedFiles.filter((file) => !knownTrees.some((tree) => file.startsWith(tree)))).toEqual([]);
  });
});
