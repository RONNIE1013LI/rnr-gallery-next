import { getDatabase } from "@/server/db/client";
import { createDrizzleProductionProofRepository } from "@/server/production/drizzle-production-proof-repository";
import { createProductionProofService } from "@/server/production/production-proof-service";
import { createPrivateUploadStore } from "@/server/uploads/private-upload-store";

export function getAdminProductionProofRuntime() {
  const repository = createDrizzleProductionProofRepository(getDatabase());
  const service = createProductionProofService(repository);
  const store = createPrivateUploadStore();
  return Object.freeze({
    registerFile: service.registerFile,
    recordReview: service.recordReview,
    deletePaymentProof: service.deletePaymentProof,
    listFiles: service.listFiles,
    getPrivateFile: service.getPrivateFile,
    save: store.save.bind(store),
    remove: store.remove.bind(store),
    read: store.read.bind(store),
  });
}
