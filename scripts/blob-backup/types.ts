export type BackupCategory = "gallery" | "private";
export type BackupRetentionClass = "business-long-term" | "private-source-bound";

export type BackupPayloadMetadata = Readonly<{
  category: BackupCategory;
  contentType: string;
  sourceKey: string;
  checksumSha256: string;
  size: number;
}>;
export type BackupManifestEntry = BackupPayloadMetadata & Readonly<{
  sourceUploadedAt: string;
  backedUpAt: string;
  retentionClass: BackupRetentionClass;
  backupObjectId: string;
}>;

export type BackupManifest = Readonly<{
  format: 1;
  runId: string;
  createdAt: string;
  category: BackupCategory;
  entries: readonly BackupManifestEntry[];
}>;
