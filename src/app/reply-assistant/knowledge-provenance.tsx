import styles from "./reply-assistant.module.css";

export function KnowledgeProvenance(input: Readonly<{
  knowledgeVersion: string;
  metadata: Readonly<{
    buildVersion: string;
    sourceCommit: string;
    compiledAt: string;
    sourceChecksum: string;
  }>;
}>) {
  const compiledAt = new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Pacific/Auckland",
  }).format(new Date(input.metadata.compiledAt));
  const values = [
    ["Knowledge", input.knowledgeVersion.slice(0, 12)],
    ["Source commit", input.metadata.sourceCommit.slice(0, 12)],
    ["Compiled", compiledAt],
    ["Checksum", input.metadata.sourceChecksum.slice(0, 12)],
  ] as const;

  return (
    <dl className={styles.knowledgeProvenance} aria-label="Active customer service knowledge">
      {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}
