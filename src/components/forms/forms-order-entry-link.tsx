"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import styles from "./forms.module.css";

export function FormsOrderEntryLink({ currentPath }: Readonly<{ currentPath: string }>) {
  const searchParams = useSearchParams();
  const route = currentPath.split("?", 1)[0];
  const params = new URLSearchParams(route === "/order-system" ? searchParams.toString() : "");
  params.set("entry", "new");

  return <Link className={styles.orderEntry} href={`/order-system?${params.toString()}`}>Order entry</Link>;
}
