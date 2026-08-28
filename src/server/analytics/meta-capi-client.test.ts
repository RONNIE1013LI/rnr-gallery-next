import { describe, expect, it, vi } from "vitest";
import {
  createMetaCapiClient,
  hashMetaEmail,
  hashMetaPhone,
  type SafeMetaEvent,
} from "./meta-capi-client";

const event: SafeMetaEvent = {
  name: "Purchase",
  eventId: "purchase:RNR-2026-ABC",
  eventTime: 1_787_900_000,
  sourceUrl: "https://rnrgallery.com/orders/confirmation",
  currency: "AUD",
  value: 224.99,
  contentIds: ["photo-print-canvas"],
  contents: [{ id: "photo-print-canvas", quantity: 1, itemPrice: 169.99 }],
  fbp: "fb.1.1787900000000.123456789",
  hashedEmail: hashMetaEmail(" Customer@Example.COM "),
  hashedPhone: hashMetaPhone("+61 412 345 678"),
};

describe("Meta CAPI client", () => {
  it("sends only the allowlisted CAPI payload with server-only authorization", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ events_received: 1 }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const client = createMetaCapiClient({ accessToken: "server-secret", fetchImpl });

    await expect(client.send(event)).resolves.toBe("sent");
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v23.0/608163224977716/events");
    expect(request.headers.Authorization).toBe("Bearer server-secret");
    const body = JSON.parse(String(request.body));
    expect(body).toEqual({ data: [{
      event_name: "Purchase",
      event_id: "purchase:RNR-2026-ABC",
      event_time: 1_787_900_000,
      action_source: "website",
      event_source_url: "https://rnrgallery.com/orders/confirmation",
      user_data: {
        em: ["e233d4a29013e9d87150c6237c6777bedf379ebf1acdc5d6126fec7e8bb74fb5"],
        ph: ["222e24d90b23ba2af558a2891bfa399f19a7eb9f33df34a7d6809b97c5a97246"],
        fbp: "fb.1.1787900000000.123456789",
      },
      custom_data: {
        content_ids: ["photo-print-canvas"],
        content_type: "product",
        contents: [{ id: "photo-print-canvas", quantity: 1, item_price: 169.99 }],
        currency: "AUD",
        value: 224.99,
      },
    }] });
    expect(JSON.stringify(body)).not.toMatch(/Customer@|\+61|server-secret|address|postcode|notes/i);
  });

  it("makes no request without credentials, consent-approved matching, or a valid contract", async () => {
    const fetchImpl = vi.fn();
    await expect(createMetaCapiClient({ accessToken: "", fetchImpl }).send(event))
      .resolves.toBe("disabled");
    await expect(createMetaCapiClient({ accessToken: "secret", fetchImpl }).send({
      ...event,
      fbp: undefined,
      hashedEmail: undefined,
      hashedPhone: undefined,
    })).resolves.toBe("disabled");
    await expect(createMetaCapiClient({ accessToken: "secret", fetchImpl }).send({
      ...event,
      rawEmail: "private@example.test",
    } as SafeMetaEvent)).resolves.toBe("failed");
    await expect(createMetaCapiClient({ accessToken: "secret", fetchImpl }).send({
      ...event,
      currency: undefined,
      value: undefined,
      contentIds: undefined,
      contents: undefined,
    })).resolves.toBe("failed");
    await expect(createMetaCapiClient({ accessToken: "secret", fetchImpl }).send({
      ...event,
      name: "PageView",
      eventId: "00000000-0000-4000-8000-000000000001",
    })).resolves.toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on timeout without exposing or throwing provider errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, request) =>
      new Promise<Response>((_resolve, reject) => {
        request?.signal?.addEventListener("abort", () => reject(new Error("server-secret")));
      }));
    const client = createMetaCapiClient({ accessToken: "server-secret", fetchImpl, timeoutMs: 5 });
    await expect(client.send(event)).resolves.toBe("failed");
  });
});
