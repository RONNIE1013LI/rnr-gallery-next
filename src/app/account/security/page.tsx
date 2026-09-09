import type { Metadata } from "next";
import { StaffAccountSecurity } from "@/components/staff-account-security";
import { safeAuthReturnPath } from "@/server/auth/safe-return-path";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "Account security | R&R Gallery", robots: { index: false, follow: false } };
export default async function StaffSecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeAuthReturnPath(params.next, "/admin") : "/admin";
  return <main id="main-content" className={styles.legalPage}><StaffAccountSecurity returnTo={next} /></main>;
}
