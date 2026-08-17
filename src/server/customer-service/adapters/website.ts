import type { ChannelAdapter } from "../types";

export class WebsiteChannelNotEnabledError extends Error {
  constructor() {
    super("Website customer service channel is not enabled");
    this.name = "WebsiteChannelNotEnabledError";
  }
}

export const websiteChannelAdapter: ChannelAdapter<unknown> = Object.freeze({
  channel: "website",
  normalize() {
    throw new WebsiteChannelNotEnabledError();
  },
});
