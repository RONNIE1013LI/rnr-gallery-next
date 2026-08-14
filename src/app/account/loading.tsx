import { AuthGateway } from "@/components/auth-gateway";
import styles from "@/components/storefront.module.css";
import {
  getConfiguredSocialProviderIds,
  type SocialProviderId,
} from "@/server/auth/social-provider-config";

export default function AccountLoading() {
  const configuredProviders = getConfiguredSocialProviderIds(process.env);
  const customerProviders = configuredProviders.includes("google")
    ? (["google"] as const)
    : ([] as const) as ReadonlyArray<SocialProviderId>;

  return <main id="main-content" className={styles.legalPage}>
    <article className={`${styles.authPage} ${styles.customerAuthPage}`}>
      <AuthGateway
        configuredProviders={customerProviders}
        mode="sign-in"
        returnTo="/account"
      />
    </article>
  </main>;
}
