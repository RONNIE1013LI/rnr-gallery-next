import { parsePhoneNumberFromString } from "libphonenumber-js";

const emailPattern = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/i;
const australianRegionPattern = /\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i;

export type ParsedCustomerBlock = Readonly<{
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryAddress: string;
  country: "NZ" | "AU";
}>;

function likelyAustralia(text: string, deliveryMethod: string) {
  return deliveryMethod === "australia_shipping" ||
    /\baustralia\b/i.test(text) ||
    australianRegionPattern.test(text);
}

function looksLikeAddress(line: string) {
  return /^\s*(?:\d|unit\b|flat\b|level\b|suite\b|shop\b|po\s*box\b)/i.test(line) ||
    /\b\d{4}\b/.test(line) ||
    /\b(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|close|crescent|court|place|highway|parade|terrace|way)\b/i.test(line) ||
    /\b(?:new zealand|australia)\b/i.test(line) ||
    australianRegionPattern.test(line);
}

function normalizedPhone(line: string, country: "NZ" | "AU") {
  const digits = line.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  const parsed = parsePhoneNumberFromString(line, country);
  if (!parsed?.isValid() || (parsed.country !== "NZ" && parsed.country !== "AU")) return "";
  return parsed.number;
}

export function parseCustomerBlock(
  input: string,
  deliveryMethod = "post",
): ParsedCustomerBlock {
  const source = input.replace(/\r\n?/g, "\n").trim();
  const country = likelyAustralia(source, deliveryMethod) ? "AU" : "NZ";
  const remaining: string[] = [];
  let customerEmail = "";
  let customerPhone = "";

  for (const rawLine of source.split("\n")) {
    let line = rawLine.trim();
    if (!line) continue;
    if (!customerEmail) {
      const match = line.match(emailPattern);
      if (match) {
        customerEmail = match[0].toLowerCase();
        line = `${line.slice(0, match.index)} ${line.slice((match.index ?? 0) + match[0].length)}`.trim();
      }
    }
    if (!customerPhone) {
      const phone = normalizedPhone(line, country);
      if (phone) {
        customerPhone = phone;
        line = "";
      }
    }
    if (line) remaining.push(line);
  }

  let customerName = "";
  if (remaining.length > 1 && !looksLikeAddress(remaining[0]!)) {
    customerName = remaining.shift()!;
  }

  return Object.freeze({
    customerName,
    customerEmail,
    customerPhone,
    deliveryAddress: remaining.join("\n"),
    country,
  });
}
