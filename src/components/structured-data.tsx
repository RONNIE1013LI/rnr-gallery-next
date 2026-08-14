export function StructuredData({
  id,
  data,
}: Readonly<{ id: string; data: Readonly<Record<string, unknown>> }>) {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  return <script id={id} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
