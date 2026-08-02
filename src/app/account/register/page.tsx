import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article className={styles.authPage}>
        <p className={styles.eyebrow}>Customer account</p>
        <h1>Create your account.</h1>
        <p>Save your details for a simpler R&amp;R Gallery order experience.</p>
        <AuthForm mode="register" />
      </article>
    </main>
  );
}
