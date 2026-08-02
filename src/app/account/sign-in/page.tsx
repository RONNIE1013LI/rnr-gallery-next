import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article className={styles.authPage}>
        <p className={styles.eyebrow}>Customer account</p>
        <h1>Welcome back.</h1>
        <p>Sign in to keep your R&amp;R Gallery orders and details together.</p>
        <AuthForm mode="sign-in" />
      </article>
    </main>
  );
}
