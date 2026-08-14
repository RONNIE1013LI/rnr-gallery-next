import type { Metadata } from "next";
import { AuthGateway } from "@/components/auth-gateway";
import styles from "@/components/storefront.module.css";
import { getConfiguredSocialProviderIds } from "@/server/auth/social-provider-config";
import type { SocialProviderId } from "@/server/auth/social-provider-config";

export const metadata: Metadata = { title: "Sign in" };

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default async function SignInPage({ searchParams }: Props) {
  const rawNext = (await searchParams).next;
  const returnTo = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  const configuredProviders = getConfiguredSocialProviderIds(process.env);
  const customerProviders = configuredProviders.includes("google")
    ? (["google"] as const)
    : ([] as const) as ReadonlyArray<SocialProviderId>;

  return (
    <main id="main-content" className={styles.legalPage}>
      <article className={`${styles.authPage} ${styles.customerAuthPage}`}>
        <AuthGateway
          configuredProviders={customerProviders}
          mode="sign-in"
          returnTo={returnTo}
        />
      </article>
    </main>
  );
}
