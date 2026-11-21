const headingPhrases = /(\b(?:New Zealand|R&R Gallery|Wall Banners?|Roll[-‑]Up Banners?|Oil Painting|Photo Print|Grave Covers?)\b[.,!?]?)/gi;

export function keepHeadingPhrasesTogether(text: string) {
  return text.split(headingPhrases).map((part, index) => (
    index % 2 ? <span className="keep-phrase" key={index}>{part}</span> : part
  ));
}
