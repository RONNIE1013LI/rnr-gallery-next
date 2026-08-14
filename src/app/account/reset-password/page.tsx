import type { Metadata } from "next";
import Link from "next/link";
import { PasswordResetForm } from "@/components/password-reset-form";
import styles from "@/components/storefront.module.css";
import { getPasswordResetTokenStatus } from "@/server/auth/password-reset-token";

export const metadata: Metadata = { title: "Reset password" };

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = scalar(params.token) ?? "";
  let status: "valid" | "invalid" | "unavailable" = "invalid";
  if (!scalar(params.error)) {
    try {
      status = await getPasswordResetTokenStatus(token);
    } catch {
      status = "unavailable";
    }
  }
  const valid = status === "valid";

  return <main id="main-content" className={styles.legalPage}>
    <article className={styles.authPage}>
      <p className={styles.eyebrow}>Customer account</p>
      <h1>{valid ? "Choose a new password." : "Reset link unavailable."}</h1>
      {!valid ? <>
        <p className={styles.authLead}>{status === "unavailable"
          ? "We could not verify this reset link right now. Please try again shortly or request a new link."
          : "This reset link is invalid, expired or has already been used."}</p>
        <p className={styles.authSwitch}>
          <Link href="/account/forgot-password">Request a new reset link</Link>
        </p>
        <p className={styles.authSwitch}>
          <Link href="/account/sign-in">Return to sign in</Link>
        </p>
      </> : <PasswordResetForm mode="reset" token={token} />}
    </article>
  </main>;
}
