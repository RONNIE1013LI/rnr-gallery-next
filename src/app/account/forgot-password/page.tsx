import type { Metadata } from "next";
import { PasswordResetForm } from "@/components/password-reset-form";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return <main id="main-content" className={styles.legalPage}>
    <article className={styles.authPage}>
      <p className={styles.eyebrow}>Customer account</p>
      <h1>Reset your password.</h1>
      <p className={styles.authLead}>Enter your email and we’ll send you a secure reset link.</p>
      <PasswordResetForm mode="request" />
    </article>
  </main>;
}
