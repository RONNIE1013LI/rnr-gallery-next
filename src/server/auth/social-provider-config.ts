export type SocialProviderId = "google" | "github" | "apple";

type AuthEnvironment = Readonly<Record<string, string | undefined>>;
type ProviderCredentials = Readonly<{
  clientId: string;
  clientSecret: string;
}>;

function credentials(
  env: AuthEnvironment,
  clientIdKey: string,
  clientSecretKey: string,
) {
  const clientId = env[clientIdKey]?.trim();
  const clientSecret = env[clientSecretKey]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getSocialProviderOptions(env: AuthEnvironment) {
  const options: Partial<Record<SocialProviderId, ProviderCredentials>> = {};
  const google = credentials(env, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
  const github = credentials(env, "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET");
  const apple = credentials(env, "APPLE_CLIENT_ID", "APPLE_CLIENT_SECRET");

  if (google) options.google = google;
  if (github) options.github = github;
  if (apple) options.apple = apple;
  return options;
}

export function getConfiguredSocialProviderIds(env: AuthEnvironment) {
  const options = getSocialProviderOptions(env);
  return (["google", "github", "apple"] as const).filter(
    (provider) => options[provider],
  );
}
