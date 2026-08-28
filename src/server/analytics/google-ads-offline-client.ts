export type GoogleAdsOfflineConversionConfig = Readonly<{
  customerId: string;
  conversionActionId: string;
  developerToken: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRefreshToken: string;
  loginCustomerId?: string;
}>;

export type GoogleAdsOfflineConversion = Readonly<{
  transactionId: string;
  paidAt: Date;
  currency: "NZD" | "AUD";
  value: number;
  click: Readonly<{ kind: "gclid" | "gbraid" | "wbraid"; id: string }>;
}>;

type SendResult = "disabled" | "sent" | "failed";
const digits = /^\d{6,20}$/;
const clickId = /^[A-Za-z0-9._~-]{1,200}$/;
const transactionId = /^[A-Za-z0-9:-]{3,100}$/;

export function parseGoogleAdsOfflineConversionConfig(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): GoogleAdsOfflineConversionConfig | null {
  const values = {
    customerId: env.GOOGLE_ADS_CUSTOMER_ID?.trim() ?? "",
    conversionActionId: env.GOOGLE_ADS_CONVERSION_ACTION_ID?.trim() ?? "",
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() ?? "",
    oauthClientId: env.GOOGLE_ADS_OAUTH_CLIENT_ID?.trim() ?? "",
    oauthClientSecret: env.GOOGLE_ADS_OAUTH_CLIENT_SECRET?.trim() ?? "",
    oauthRefreshToken: env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN?.trim() ?? "",
    loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() ?? "",
  };
  if (!digits.test(values.customerId)
    || !digits.test(values.conversionActionId)
    || !values.developerToken
    || !values.oauthClientId
    || !values.oauthClientSecret
    || !values.oauthRefreshToken
    || (values.loginCustomerId && !digits.test(values.loginCustomerId))) return null;
  return Object.freeze({
    customerId: values.customerId,
    conversionActionId: values.conversionActionId,
    developerToken: values.developerToken,
    oauthClientId: values.oauthClientId,
    oauthClientSecret: values.oauthClientSecret,
    oauthRefreshToken: values.oauthRefreshToken,
    ...(values.loginCustomerId ? { loginCustomerId: values.loginCustomerId } : {}),
  });
}

function formatConversionTime(value: Date) {
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "+00:00");
}

function validConversion(value: GoogleAdsOfflineConversion) {
  return transactionId.test(value.transactionId)
    && formatConversionTime(value.paidAt) !== null
    && (value.currency === "NZD" || value.currency === "AUD")
    && Number.isFinite(value.value)
    && value.value > 0
    && clickId.test(value.click.id)
    && ["gclid", "gbraid", "wbraid"].includes(value.click.kind);
}

async function jsonResponse(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.ok || !/^application\/json(?:;|$)/i.test(
    response.headers.get("content-type") ?? "",
  )) return null;
  try {
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function createGoogleAdsOfflineConversionClient({
  config,
  fetchImpl = fetch,
  timeoutMs = 3_000,
}: Readonly<{
  config: GoogleAdsOfflineConversionConfig | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>) {
  return Object.freeze({
    async send(conversion: GoogleAdsOfflineConversion): Promise<SendResult> {
      if (!config) return "disabled";
      if (!validConversion(conversion)) return "failed";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const tokenResponse = await fetchImpl("https://www.googleapis.com/oauth2/v3/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: config.oauthClientId,
            client_secret: config.oauthClientSecret,
            refresh_token: config.oauthRefreshToken,
          }).toString(),
          redirect: "error",
          signal: controller.signal,
        });
        const token = await jsonResponse(tokenResponse);
        const accessToken = typeof token?.access_token === "string"
          ? token.access_token.trim()
          : "";
        if (!accessToken) return "failed";
        const uploadResponse = await fetchImpl(
          `https://googleads.googleapis.com/v25/customers/${config.customerId}:uploadClickConversions`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "developer-token": config.developerToken,
              ...(config.loginCustomerId
                ? { "login-customer-id": config.loginCustomerId }
                : {}),
            },
            body: JSON.stringify({
              conversions: [{
                conversionAction: `customers/${config.customerId}/conversionActions/${config.conversionActionId}`,
                conversionDateTime: formatConversionTime(conversion.paidAt),
                conversionValue: conversion.value,
                currencyCode: conversion.currency,
                orderId: conversion.transactionId,
                [conversion.click.kind]: conversion.click.id,
                consent: { adUserData: "GRANTED" },
              }],
              partialFailure: true,
              validateOnly: false,
            }),
            redirect: "error",
            signal: controller.signal,
          },
        );
        const result = await jsonResponse(uploadResponse);
        return result && !result.partialFailureError
          && Array.isArray(result.results) && result.results.length === 1
          ? "sent"
          : "failed";
      } catch {
        return "failed";
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
