import compiledSource from "./compiled-business-brain.json";
import { type CompiledBusinessBrain } from "./schema";

export function loadBusinessBrain(): CompiledBusinessBrain {
  const compiled = compiledSource as CompiledBusinessBrain;
  if (compiled.version !== "0.5.1" || compiled.effectiveDate !== "2026-09-04") {
    throw new Error("Unsupported R&R Business Brain artifact");
  }
  return compiled;
}
