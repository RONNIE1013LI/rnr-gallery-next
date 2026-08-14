import type { Metadata } from "next";
import { AuthGateway } from "@/components/auth-gateway";
import styles from "@/components/storefront.module.css";
import { getConfiguredSocialProviderIds } from "@/server/auth/social-provider-config";
import type { SocialProviderId } from "@/server/auth/social-provider-config";

export const metadata: Metadata = { title: "Create account" };

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default async function RegisterPage({ searchParams }: Props) {
  const rawNext = (await searchParams).next;
  const returnTo = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  const configuredProviders = getConfiguredSocialProviderIds(process.env);
  const customerProviders = configuredProviders.includes("google")
    ? (["google"] as const)
    : ([] as const) as ReadonlyArray<SocialProviderId>;

  return (
    <main id="main-content" className={styles.legalPage}>
      <article className={styles.authPage}>
        <AuthGateway
          configuredProviders={customerProviders}
          mode="register"
          returnTo={returnTo}
        />
      </article>
    </main>
  );
}
