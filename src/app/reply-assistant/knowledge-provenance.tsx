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
    ["Knowledge hash", input.knowledgeVersion.slice(0, 12)],
    ["Source commit", input.metadata.sourceCommit.slice(0, 12)],
    ["Compiled timestamp", compiledAt],
    ["Checksum", input.metadata.sourceChecksum.slice(0, 12)],
  ] as const;

  return (
    <section className={styles.knowledgePanel} aria-labelledby="knowledge-title">
      <div className={styles.knowledgeSummary}>
        <h2 id="knowledge-title">Business Knowledge</h2>
        <p>Version: <strong>v0.5.1</strong></p>
        <p>Last updated: {compiledAt}</p>
      </div>
      <details className={styles.knowledgeDisclosure}>
        <summary>Advanced diagnostics</summary>
        <dl className={styles.knowledgeProvenance} aria-label="Business Knowledge diagnostics">
          {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </details>
    </section>
  );
}
