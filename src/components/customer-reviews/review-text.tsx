import { reviewTextCss, reviewTextSegments, type ReviewTextStyle } from "@/domain/customer-reviews/text-style";

export function ReviewText({ text, style }: Readonly<{ text: string; style?: ReviewTextStyle }>) {
  if (!style?.ranges?.length) return text;
  return reviewTextSegments(text, style).map((segment, index) => <span key={index} style={reviewTextCss(segment.style)}>{segment.text}</span>);
}
