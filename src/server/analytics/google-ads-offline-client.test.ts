import { describe, expect, it, vi } from "vitest";
import {
  createGoogleAdsOfflineConversionClient,
  parseGoogleAdsOfflineConversionConfig,
} from "./google-ads-offline-client";

const config = {
  customerId: "1234567890",
  conversionActionId: "987654321",
  developerToken: "developer-secret",
  oauthClientId: "oauth-client.apps.googleusercontent.com",
  oauthClientSecret: "oauth-secret",
  oauthRefreshToken: "refresh-secret",
  loginCustomerId: "1112223334",
} as const;

const conversion = {
  transactionId: "manual:08000",
  paidAt: new Date("2026-08-28T01:02:03.000Z"),
  currency: "AUD" as const,
  value: 123.45,
  click: { kind: "wbraid" as const, id: "web-braid_123" },
};

describe("Google Ads offline conversion client", () => {
  it("fails closed when any server-only credential or resource ID is missing", async () => {
    expect(parseGoogleAdsOfflineConversionConfig({})).toBeNull();
    expect(parseGoogleAdsOfflineConversionConfig({
      GOOGLE_ADS_CUSTOMER_ID: config.customerId,
      GOOGLE_ADS_CONVERSION_ACTION_ID: config.conversionActionId,
    })).toBeNull();
    const fetchImpl = vi.fn();
    const client = createGoogleAdsOfflineConversionClient({ config: null, fetchImpl });
    await expect(client.send(conversion)).resolves.toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes OAuth then uploads exactly one official click-conversion contract", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ access_token: "short-lived-access", expires_in: 3_600, token_type: "Bearer" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ results: [{ wbraid: "web-braid_123" }], jobId: "10" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
    const client = createGoogleAdsOfflineConversionClient({ config, fetchImpl });

    await expect(client.send(conversion)).resolves.toBe("sent");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://www.googleapis.com/oauth2/v3/token");
    const tokenRequest = fetchImpl.mock.calls[0][1];
    expect(tokenRequest.method).toBe("POST");
    expect(String(tokenRequest.body)).toContain("grant_type=refresh_token");
    expect(fetchImpl.mock.calls[1][0]).toBe(
      "https://googleads.googleapis.com/v25/customers/1234567890:uploadClickConversions",
    );
    const uploadRequest = fetchImpl.mock.calls[1][1];
    expect(uploadRequest.headers).toMatchObject({
      Authorization: "Bearer short-lived-access",
      "developer-token": "developer-secret",
      "login-customer-id": "1112223334",
    });
    expect(JSON.parse(String(uploadRequest.body))).toEqual({
      conversions: [{
        conversionAction: "customers/1234567890/conversionActions/987654321",
        conversionDateTime: "2026-08-28 01:02:03+00:00",
        conversionValue: 123.45,
        currencyCode: "AUD",
        orderId: "manual:08000",
        wbraid: "web-braid_123",
        consent: { adUserData: "GRANTED" },
      }],
      partialFailure: true,
      validateOnly: false,
    });
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("customer@example");
  });

  it("does not record an HTTP 200 partial failure as sent", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ access_token: "short-lived-access" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ partialFailureError: { code: 3, message: "invalid click" }, results: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
    const client = createGoogleAdsOfflineConversionClient({ config, fetchImpl });
    await expect(client.send(conversion)).resolves.toBe("failed");
  });
});
