export type ConfirmedPaymentStatus =
  | "processing"
  | "paid"
  | "failed"
  | "cancelled";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function confirmCurrentOrderPayment(
  confirmationUrl: string,
): Promise<ConfirmedPaymentStatus> {
  const response = await fetch(confirmationUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm" }),
    cache: "no-store",
    credentials: "same-origin",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Payment confirmation response is invalid");
  }
  const status = record(record(payload)?.payment)?.status;
  if (
    !response.ok ||
    (status !== "processing" && status !== "paid" &&
      status !== "failed" && status !== "cancelled")
  ) {
    throw new Error("Payment confirmation is unavailable");
  }
  return status;
}
