import styles from "./reply-assistant.module.css";

export function KnowledgeProvenance(input: Readonly<{
  businessBrain: Readonly<{
    version: string;
    effectiveDate: string;
    sourceSha256: string;
  }>;
}>) {
  const effectiveDate = new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeZone: "Pacific/Auckland",
  }).format(new Date(`${input.businessBrain.effectiveDate}T00:00:00.000Z`));
  const values = [
    ["Business Brain version", `v${input.businessBrain.version}`],
    ["Effective date", effectiveDate],
    ["Artifact checksum", input.businessBrain.sourceSha256.slice(0, 12)],
  ] as const;

  return (
    <section className={styles.knowledgePanel} aria-labelledby="knowledge-title">
      <div className={styles.knowledgeSummary}>
        <h2 id="knowledge-title">Business Knowledge</h2>
        <p>Version: <strong>v{input.businessBrain.version}</strong></p>
        <p>Effective from: {effectiveDate}</p>
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
