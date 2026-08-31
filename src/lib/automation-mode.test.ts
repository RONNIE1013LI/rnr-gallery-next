import { afterEach, describe, expect, it, vi } from "vitest";

import { pollingAllowedForAutomation, readAutomationSession } from "./automation-mode";

describe("automation mode", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists an exact query marker and capability across same-tab navigation", () => {
    window.history.replaceState(null, "", "/?rnr_automation=1&rnr_automation_capability=DEFAULT");

    expect(readAutomationSession()).toEqual({ active: true, capability: "DEFAULT" });
    expect(window.sessionStorage.getItem("rnr_automation")).toBe("1");
    expect(window.sessionStorage.getItem("rnr_automation_capability")).toBe("DEFAULT");

    window.history.replaceState(null, "", "/shop");

    expect(readAutomationSession()).toEqual({ active: true, capability: "DEFAULT" });
  });

  it("treats malformed capabilities as null and non-exact or absent markers as inactive", () => {
    window.history.replaceState(null, "", "/?rnr_automation=1&rnr_automation_capability=NOT_APPROVED");
    expect(readAutomationSession()).toEqual({ active: true, capability: null });

    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/?rnr_automation=true&rnr_automation_capability=DEFAULT");
    expect(readAutomationSession()).toEqual({ active: false, capability: null });

    window.history.replaceState(null, "", "/?rnr_automation_capability=DEFAULT");
    expect(readAutomationSession()).toEqual({ active: false, capability: null });
  });

  it("keeps query-driven automation readable when session storage rejects writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    window.history.replaceState(null, "", "/?rnr_automation=1&rnr_automation_capability=VISUAL");

    expect(readAutomationSession()).toEqual({ active: true, capability: "VISUAL" });
  });

  it.each(["DEFAULT", "VISUAL", "ATTRIBUTION", "REPLY_ASSISTANT_TEST", "EXTENDED"] as const)(
    "disables Customer Chat for active %s automation",
    (capability) => {
      window.sessionStorage.setItem("rnr_automation", "1");
      window.sessionStorage.setItem("rnr_automation_capability", capability);

      expect(pollingAllowedForAutomation("customer-chat")).toBe(false);
    },
  );

  it("allows Reply Assistant automation polling only for REPLY_ASSISTANT_TEST", () => {
    window.sessionStorage.setItem("rnr_automation", "1");

    for (const capability of ["DEFAULT", "VISUAL", "ATTRIBUTION", "EXTENDED", "NOT_APPROVED"]) {
      window.sessionStorage.setItem("rnr_automation_capability", capability);
      expect(pollingAllowedForAutomation("reply-assistant")).toBe(false);
    }

    window.sessionStorage.setItem("rnr_automation_capability", "REPLY_ASSISTANT_TEST");
    expect(pollingAllowedForAutomation("reply-assistant")).toBe(true);

    window.sessionStorage.clear();
    expect(pollingAllowedForAutomation("customer-chat")).toBe(true);
    expect(pollingAllowedForAutomation("reply-assistant")).toBe(true);
  });
});
