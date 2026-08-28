import { parsePaymentConfig } from "./config";
import {
  diagnoseAfterpayConfiguration,
  type AfterpayConfigurationDiagnostic,
} from "./afterpay-provider";

const NOT_CONFIGURED: AfterpayConfigurationDiagnostic = Object.freeze({
  connection: "FAIL",
  crossBorderTrade: "NOT_CHECKED",
  australiaCountry: "NOT_CHECKED",
  audLimits: "NOT_CHECKED",
  audEligibility: "NOT_CHECKED",
});

export async function runAfterpayConfigurationDiagnostic(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
) {
  const config = parsePaymentConfig(env).afterpay;
  if (!config.enabled) return NOT_CONFIGURED;
  return diagnoseAfterpayConfiguration({ config, fetchImpl });
}
