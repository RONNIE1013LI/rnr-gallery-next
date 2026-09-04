import styles from "./reply-assistant.module.css";

export function KnowledgeProvenance(input: Readonly<{
  businessBrain: Readonly<{
    version: string;
    effectiveDate: string;
    sourceSha256: string;
  }>;
  supportingKnowledge: Readonly<{
    knowledgeVersion: string;
    sourceCommit: string;
    compiledAt: string;
    sourceChecksum: string;
  }>;
}>) {
  const effectiveDate = new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeZone: "Pacific/Auckland",
  }).format(new Date(`${input.businessBrain.effectiveDate}T00:00:00.000Z`));
  const compiledAt = new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Pacific/Auckland",
  }).format(new Date(input.supportingKnowledge.compiledAt));
  const businessBrainValues = [
    ["Business Brain version", `v${input.businessBrain.version}`],
    ["Effective date", effectiveDate],
    ["Artifact checksum", input.businessBrain.sourceSha256.slice(0, 12)],
  ] as const;
  const supportingKnowledgeValues = [
    ["Knowledge hash", input.supportingKnowledge.knowledgeVersion.slice(0, 12)],
    ["Source commit", input.supportingKnowledge.sourceCommit.slice(0, 12)],
    ["Checksum", input.supportingKnowledge.sourceChecksum.slice(0, 12)],
    ["Compiled timestamp", compiledAt],
  ] as const;

  return (
    <section className={styles.knowledgePanel} aria-labelledby="knowledge-title">
      <div className={styles.knowledgeSummary}>
        <h2 id="knowledge-title">Business Knowledge</h2>
        <p>Version: <strong>v{input.businessBrain.version}</strong></p>
        <p>Last updated: {compiledAt} (supporting knowledge build)</p>
      </div>
      <details className={styles.knowledgeDisclosure}>
        <summary>Advanced diagnostics</summary>
        <section className={styles.diagnosticGroup} aria-labelledby="business-brain-diagnostics">
          <h3 id="business-brain-diagnostics">Business Brain artifact</h3>
          <dl className={styles.knowledgeProvenance} aria-label="Business Brain artifact diagnostics">
            {businessBrainValues.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </section>
        <section className={styles.diagnosticGroup} aria-labelledby="supporting-knowledge-diagnostics">
          <h3 id="supporting-knowledge-diagnostics">Supporting knowledge build</h3>
          <dl className={styles.knowledgeProvenance} aria-label="Supporting knowledge build diagnostics">
            {supportingKnowledgeValues.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </section>
      </details>
    </section>
  );
}
