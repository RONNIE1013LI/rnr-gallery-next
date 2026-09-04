import { describe, expect, it, vi } from "vitest";
import { GraphMetaContextProvider } from "./graph-context-provider";

describe("GraphMetaContextProvider", () => {
  it("lists only Facebook conversations updated inside the approved backlog window", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { updated_time: "2026-09-04T00:30:00Z", participants: { data: [{ id: "page-1" }, { id: "customer-1" }] } },
        { updated_time: "2026-09-02T00:30:00Z", participants: { data: [{ id: "page-1" }, { id: "old-customer" }] } },
      ],
    }), { status: 200 }));
    const provider = new GraphMetaContextProvider({ accessToken: "secret", fetchImpl });

    await expect(provider.listConversations({
      pageId: "page-1",
      window: {
        from: "2026-09-03T01:00:00.000Z",
        to: "2026-09-04T01:00:00.000Z",
        maxConversations: 100,
      },
    })).resolves.toEqual([{
      channel: "facebook",
      externalConversationKey: "customer-1",
      pageId: "page-1",
    }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("platform=messenger"),
      expect.any(Object),
    );
  });

  it("loads paginated history with stable roles, reply links and safe image metadata", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          messages: {
            data: [
              { id: "m2", created_time: "2026-09-04T00:02:00Z", from: { id: "page-1" }, message: "We can help.", reply_to: { id: "m1" } },
              { id: "m1", created_time: "2026-09-04T00:01:00Z", from: { id: "customer-1" }, message: "Can you use this?", attachments: { data: [{ id: "a1", mime_type: "image/jpeg" }] } },
            ],
            paging: { next: "https://graph.facebook.com/v23.0/page-1/messages?after=safe" },
          },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "m0", created_time: "2026-09-03T23:59:00Z", from: { id: "customer-1" }, message: "Hello" }],
      }), { status: 200 }));
    const provider = new GraphMetaContextProvider({ accessToken: "secret", fetchImpl });

    const result = await provider.loadConversation({ channel: "facebook", externalConversationKey: "customer-1", pageId: "page-1" });

    expect(result.complete).toBe(true);
    expect(result.events.map((event) => event.externalMessageKey)).toEqual(["m0", "m1", "m2"]);
    expect(result.events.map((event) => event.role)).toEqual(["customer", "customer", "staff"]);
    expect(result.events[1]).toMatchObject({ attachments: [{ ordinal: 0, kind: "image" }] });
    expect(result.events[2].externalReplyToMessageKey).toBe("m1");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ authorization: "Bearer secret" });
  });

  it("deduplicates repeated message IDs across pages", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ messages: { data: [{ id: "m1", created_time: "2026-09-04T00:00:00Z", from: { id: "customer" }, message: "Hello" }], paging: { next: "https://graph.facebook.com/next" } } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "m1", created_time: "2026-09-04T00:00:00Z", from: { id: "customer" }, message: "Hello" }] }), { status: 200 }));
    const result = await new GraphMetaContextProvider({ accessToken: "secret", fetchImpl })
      .loadConversation({ channel: "facebook", externalConversationKey: "customer", pageId: "page" });
    expect(result.events).toHaveLength(1);
  });

  it("returns incomplete on a permission failure without logging token or response", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response("private provider response", { status: 403 }));
    const result = await new GraphMetaContextProvider({ accessToken: "secret", fetchImpl })
      .loadConversation({ channel: "facebook", externalConversationKey: "customer", pageId: "page" });
    expect(result).toMatchObject({ complete: false, incompleteReason: "provider_permission" });
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("rejects a paging URL outside the exact Graph origin", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ messages: { data: [], paging: { next: "https://evil.test/steal" } } }] }), { status: 200 }));
    const result = await new GraphMetaContextProvider({ accessToken: "secret", fetchImpl })
      .loadConversation({ channel: "facebook", externalConversationKey: "customer", pageId: "page" });
    expect(result).toMatchObject({ complete: false, incompleteReason: "pagination_gap" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("marks history incomplete at the 500-turn or 60000-character ceiling", async () => {
    const data = Array.from({ length: 501 }, (_, index) => ({
      id: `m${index}`,
      created_time: new Date(Date.parse("2026-09-01T00:00:00Z") + index * 1_000).toISOString(),
      from: { id: "customer" },
      message: "x",
    }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ messages: { data } }] }), { status: 200 }));
    const result = await new GraphMetaContextProvider({ accessToken: "secret", fetchImpl })
      .loadConversation({ channel: "facebook", externalConversationKey: "customer", pageId: "page" });
    expect(result.events).toHaveLength(500);
    expect(result).toMatchObject({ complete: false, incompleteReason: "safety_ceiling" });
  });
});
