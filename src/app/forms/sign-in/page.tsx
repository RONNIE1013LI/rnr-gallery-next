import type { Metadata } from "next";

import { AuthGateway } from "@/components/auth-gateway";
import styles from "@/components/storefront.module.css";
import { safeAuthReturnPath } from "@/server/auth/safe-return-path";
import { getConfiguredSocialProviderIds } from "@/server/auth/social-provider-config";

export const metadata: Metadata = { title: "Sign in" };

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default async function FormsSignInPage({ searchParams }: Props) {
  const rawNext = (await searchParams).next;
  const requested = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  const returnTo = safeAuthReturnPath(requested, "/order-system");
  return (
    <main id="main-content" className={styles.legalPage}>
      <article className={styles.authPage}>
        <AuthGateway
          audience="forms"
          configuredProviders={getConfiguredSocialProviderIds(process.env)}
          mode="sign-in"
          returnTo={returnTo}
        />
      </article>
    </main>
  );
}
