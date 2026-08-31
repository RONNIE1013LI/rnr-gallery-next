export type ProductionCapability =
  | "DEFAULT"
  | "VISUAL"
  | "ATTRIBUTION"
  | "REPLY_ASSISTANT_TEST"
  | "EXTENDED";

const AUTOMATION_SESSION_STORAGE_KEY = "rnr_automation";
const AUTOMATION_CAPABILITY_STORAGE_KEY = "rnr_automation_capability";

const productionCapabilities = new Set<ProductionCapability>([
  "DEFAULT",
  "VISUAL",
  "ATTRIBUTION",
  "REPLY_ASSISTANT_TEST",
  "EXTENDED",
]);

function productionCapability(value: string | null): ProductionCapability | null {
  return value && productionCapabilities.has(value as ProductionCapability)
    ? value as ProductionCapability
    : null;
}

export function readAutomationSession(): {
  active: boolean;
  capability: ProductionCapability | null;
} {
  if (typeof window === "undefined") return { active: false, capability: null };

  const query = new URLSearchParams(window.location.search);
  const queryActive = query.get(AUTOMATION_SESSION_STORAGE_KEY) === "1";
  const queryCapabilityValue = query.get(AUTOMATION_CAPABILITY_STORAGE_KEY);
  let storedActive = false;
  let storedCapabilityValue: string | null = null;

  try {
    if (queryActive) {
      window.sessionStorage.setItem(AUTOMATION_SESSION_STORAGE_KEY, "1");
      if (queryCapabilityValue !== null) {
        const queryCapability = productionCapability(queryCapabilityValue);
        if (queryCapability) {
          window.sessionStorage.setItem(AUTOMATION_CAPABILITY_STORAGE_KEY, queryCapability);
        } else {
          window.sessionStorage.removeItem(AUTOMATION_CAPABILITY_STORAGE_KEY);
        }
      }
    }
    storedActive = window.sessionStorage.getItem(AUTOMATION_SESSION_STORAGE_KEY) === "1";
    storedCapabilityValue = window.sessionStorage.getItem(AUTOMATION_CAPABILITY_STORAGE_KEY);
  } catch {
    // Browser privacy settings may block storage; the current query remains authoritative.
  }

  const active = queryActive || storedActive;
  if (!active) return { active: false, capability: null };
  const capabilityValue = queryCapabilityValue === null
    ? storedCapabilityValue
    : queryCapabilityValue;
  return { active: true, capability: productionCapability(capabilityValue) };
}

export function pollingAllowedForAutomation(channel: "customer-chat" | "reply-assistant"): boolean {
  const automation = readAutomationSession();
  if (!automation.active) return true;
  if (channel === "customer-chat") return false;
  return automation.capability === "REPLY_ASSISTANT_TEST";
}
