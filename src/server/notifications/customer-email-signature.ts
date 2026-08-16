type CustomerEmailSignatureDefinition = Readonly<{
  key: string;
  surface: "email";
  group: "Customer email signature";
  label: string;
  description: string;
  maxLength: number;
  multiline: false;
  defaultValue: string;
  allowedVariables: readonly [];
}>;

export const customerEmailSignatureDefinitions = Object.freeze([
  { key: "email.signature.signoff", surface: "email", group: "Customer email signature", label: "Sign-off", description: "Closing phrase above the customer-service team name.", maxLength: 100, multiline: false, defaultValue: "Kind regards,", allowedVariables: [] },
  { key: "email.signature.team_name", surface: "email", group: "Customer email signature", label: "Team name", description: "Customer-facing team name.", maxLength: 120, multiline: false, defaultValue: "Customer Service Team", allowedVariables: [] },
  { key: "email.signature.company_line", surface: "email", group: "Customer email signature", label: "Company line", description: "Company identity shown below the logo.", maxLength: 200, multiline: false, defaultValue: "Customer Service | R&R Gallery Ltd. NZ", allowedVariables: [] },
  { key: "email.signature.email", surface: "email", group: "Customer email signature", label: "Customer-service email", description: "Public reply contact shown in customer emails.", maxLength: 320, multiline: false, defaultValue: "customerservice@rnrgallery.com", allowedVariables: [] },
  { key: "email.signature.website_label", surface: "email", group: "Customer email signature", label: "Website label", description: "Visible website text. The destination remains the trusted site origin.", maxLength: 160, multiline: false, defaultValue: "rrgallery.co.nz", allowedVariables: [] },
  { key: "email.signature.address", surface: "email", group: "Customer email signature", label: "Street address", description: "Public business address shown in customer emails.", maxLength: 320, multiline: false, defaultValue: "11 Para Close, Fairview Heights, Auckland 0632.", allowedVariables: [] },
] as const satisfies readonly CustomerEmailSignatureDefinition[]);

export type CustomerEmailSignatureKey = typeof customerEmailSignatureDefinitions[number]["key"];
export type CustomerEmailSignatureValues = Readonly<Record<CustomerEmailSignatureKey, string>>;

export const customerEmailSignatureKeys = Object.freeze(
  customerEmailSignatureDefinitions.map((definition) => definition.key),
) as readonly CustomerEmailSignatureKey[];

export const defaultCustomerEmailSignatureValues = Object.freeze(Object.fromEntries(
  customerEmailSignatureDefinitions.map((definition) => [definition.key, definition.defaultValue]),
)) as CustomerEmailSignatureValues;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function resolveValues(values: Partial<CustomerEmailSignatureValues>) {
  return Object.freeze(Object.fromEntries(customerEmailSignatureKeys.map((key) => [
    key,
    values[key] || defaultCustomerEmailSignatureValues[key],
  ]))) as CustomerEmailSignatureValues;
}

export function renderCustomerEmailSignature(
  values: Partial<CustomerEmailSignatureValues>,
  siteUrl: string,
) {
  const resolved = resolveValues(values);
  const origin = new URL(siteUrl).origin;
  const websiteUrl = new URL("/", origin).toString();
  const logoUrl = new URL("/media/brand/rr-gallery-logo-2026.webp", origin).toString();
  const signoff = resolved["email.signature.signoff"];
  const teamName = resolved["email.signature.team_name"];
  const companyLine = resolved["email.signature.company_line"];
  const email = resolved["email.signature.email"];
  const websiteLabel = resolved["email.signature.website_label"];
  const address = resolved["email.signature.address"];

  const text = [
    signoff,
    teamName,
    "",
    companyLine,
    `📧 ${email}`,
    `🌐 ${websiteLabel}`,
    `📍 ${address}`,
  ].join("\n");
  const html = [
    '<div style="margin-top:24px;color:#333;font-family:Arial,sans-serif;line-height:1.5">',
    `<p style="margin:0 0 14px">${escapeHtml(signoff)}<br><strong>${escapeHtml(teamName)}</strong></p>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;border-collapse:collapse">',
    '<tbody><tr>',
    '<td style="width:72px;padding:0 12px 0 0;vertical-align:top">',
    `<img src="${escapeHtml(logoUrl)}" alt="R&amp;R Gallery" width="72" height="72" style="display:block;width:72px;height:72px;margin:0;border-radius:50%;object-fit:cover">`,
    '</td>',
    '<td style="padding:0;vertical-align:top;font-size:13px;line-height:18px;white-space:nowrap">',
    `<strong>${escapeHtml(companyLine)}</strong><br>`,
    `📧 <a href="mailto:${encodeURIComponent(email)}">${escapeHtml(email)}</a><br>`,
    `🌐 <a href="${escapeHtml(websiteUrl)}">${escapeHtml(websiteLabel)}</a><br>`,
    `📍 ${escapeHtml(address)}`,
    '</td>',
    '</tr></tbody></table>',
    "</div>",
  ].join("");

  return Object.freeze({ text, html });
}
