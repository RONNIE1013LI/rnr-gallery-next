import { attributionHistorySchema, classifyAttributionTouch } from "./attribution-history";

export function orderAttributionDisplay(input: Readonly<{
  first?: string | null; firstAt?: string | null;
  last?: string | null; nonDirect?: string | null; nonDirectAt?: string | null;
  acquisition?: string | null; touches?: unknown;
}>) {
  const parsed = attributionHistorySchema.safeParse(input.touches);
  const history = parsed.success ? parsed.data : null;
  const historyNonDirect = history?.lastNonDirectTouch;
  const useHistoryNonDirect = historyNonDirect && (!input.nonDirect
    || (input.nonDirectAt && Date.parse(historyNonDirect.at) > Date.parse(input.nonDirectAt)));
  const nonDirect = useHistoryNonDirect ? classifyAttributionTouch(historyNonDirect).channel : input.nonDirect;
  const useHistoryFirst = history && (!input.first || input.first === "unattributed"
    || (input.firstAt && Date.parse(history.firstTouch.at) < Date.parse(input.firstAt)));
  return {
    firstTouch: useHistoryFirst ? classifyAttributionTouch(history.firstTouch).channel : input.first || "unattributed",
    lastTouch: input.last || (history ? classifyAttributionTouch(history.lastTouch).channel : "unattributed"),
    lastNonDirectTouch: nonDirect || "unattributed",
    acquisition: nonDirect || input.acquisition || (history ? classifyAttributionTouch(history.firstTouch).channel : "unattributed"),
  };
}
