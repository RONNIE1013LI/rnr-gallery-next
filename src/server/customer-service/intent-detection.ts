export type CustomerServiceIntent =
  | "tone_adjustment"
  | "product_differences"
  | "quote_information_collection"
  | "design_process"
  | "photo_guidance"
  | "production_process"
  | "payment_process"
  | "revision_policy"
  | "unknown";

export function isGenericBannerQuoteEnquiry(message: string) {
  const asksPrice = /\bhow much\b|\bprice\b|\bcost\b|\bquote\b/i.test(message);
  const mentionsBanner = /\bbanners?\b/i.test(message);
  const namesProductType = /\broll[ -]?up\b|\bwall\b|\blandscape\b|\bhanging\b|\bdigital(?: oil)?(?: painting)?\b|\bcanvas\b/i.test(message);
  const namesSize = /\bA[0-4]\b|\b\d+\s*[x×]\s*\d+\b/i.test(message);
  return asksPrice && mentionsBanner && !namesProductType && !namesSize;
}

export function detectIntent(message: string): CustomerServiceIntent {
  const value = String(message ?? "").trim().toLowerCase();

  if (/revision|free changes|changes included/.test(value)) return "revision_policy";
  if (isGenericBannerQuoteEnquiry(value)) return "quote_information_collection";
  if (/what details|what information|prepare a quote|information.*quote|details.*quote|get a quote|quote please|want a quote/.test(value)) {
    return "quote_information_collection";
  }
  if (/which product|product format|difference.*(?:canvas|banner)|canvas.*(?:vs|or).*banner|wall or freestanding|freestanding display/.test(value)) {
    return "product_differences";
  }
  if (/blurry|blurred|low.?resolution|photo quality|original photo|original file|use these photos|use my photos|combine.*(?:photos?|photographs?)|separate files|uncropped/.test(value)) {
    return "photo_guidance";
  }
  if (/deposit|payment process|how.*payment|pay partly|part payment|split payment|weekly payment|afterpay|\bzip\b/.test(value)) {
    return "payment_process";
  }
  if (/design process|design work|how.*design|what happens.*design|(?:see|review).*(?:design )?draft|(?:design )?draft.*before print|theme|background idea|wording/.test(value)) {
    return "design_process";
  }
  if (/production process|production steps|how.*(?:made|produced)|what happens after.*(?:photo|detail)|production workflow/.test(value)) {
    return "production_process";
  }
  if (/^(?:hi|hello|hey|kia ora|kiaora)\b|thank you|thanks|make (?:this|it) (?:warmer|friendlier)|tone/.test(value)) {
    return "tone_adjustment";
  }
  return "unknown";
}
