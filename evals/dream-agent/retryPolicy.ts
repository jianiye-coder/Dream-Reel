export function isRetryableEvalRequest(status: number, errorCode?: string) {
  if (errorCode === "credit_balance_exhausted" || errorCode === "insufficient_quota") return false;
  return status === 429 || status >= 500;
}

export function evalRetryDelayMs(attempt: number, retryAfterValue?: string | null) {
  const retryAfterSeconds = Number.parseFloat(retryAfterValue ?? "");
  return Number.isFinite(retryAfterSeconds)
    ? Math.min(15_000, Math.max(500, retryAfterSeconds * 1000))
    : Math.min(15_000, 5000 * (2 ** attempt));
}
