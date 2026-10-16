import type { Lang } from "@/lib/i18n";

export const API_ERROR_CODES = {
  unauthorized: "UNAUTHORIZED",
  invalidRequest: "INVALID_REQUEST",
  rateLimited: "RATE_LIMITED",
  quotaExceeded: "QUOTA_EXCEEDED",
  configurationError: "CONFIGURATION_ERROR",
  upstreamError: "UPSTREAM_ERROR",
  timeout: "TIMEOUT",
  invalidResponse: "INVALID_RESPONSE",
  notFound: "NOT_FOUND",
  internalError: "INTERNAL_ERROR",
  billingUnavailable: "BILLING_UNAVAILABLE",
  paymentError: "PAYMENT_ERROR",
  noSubscription: "NO_SUBSCRIPTION",
  alreadySubscribed: "ALREADY_SUBSCRIBED",
} as const;

export type ApiErrorCode = typeof API_ERROR_CODES[keyof typeof API_ERROR_CODES];

const messages: Record<ApiErrorCode, Record<Lang, string>> = {
  UNAUTHORIZED: { zh: "请先登录。", en: "Please sign in first." },
  INVALID_REQUEST: { zh: "请求参数不合法。", en: "The request is invalid." },
  RATE_LIMITED: { zh: "请求过于频繁，请稍后重试。", en: "Too many requests. Please try again shortly." },
  QUOTA_EXCEEDED: { zh: "本月额度已用完，请升级 Plus 或下月继续。", en: "Your monthly limit is used up. Upgrade to Plus or try again next month." },
  CONFIGURATION_ERROR: { zh: "服务尚未配置，请联系管理员。", en: "This service is not configured. Please contact support." },
  UPSTREAM_ERROR: { zh: "AI 服务暂时不可用，请稍后重试。", en: "The AI service is temporarily unavailable. Please try again." },
  TIMEOUT: { zh: "请求超时，请稍后重试。", en: "The request timed out. Please try again." },
  INVALID_RESPONSE: { zh: "服务返回了无法解析的结果，请重试。", en: "The service returned an invalid response. Please try again." },
  NOT_FOUND: { zh: "没有找到对应记录。", en: "The requested record was not found." },
  INTERNAL_ERROR: { zh: "服务暂时出现错误，请稍后重试。", en: "Something went wrong. Please try again." },
  BILLING_UNAVAILABLE: { zh: "Plus 即将开放，现在可以先免费使用。", en: "Plus is coming soon. Everything in Free works in the meantime." },
  PAYMENT_ERROR: { zh: "付款页面暂时打不开，请稍后再试。没有产生任何扣款。", en: "The payment page couldn’t open. Nothing was charged. Please try again shortly." },
  NO_SUBSCRIPTION: { zh: "还没有可以管理的订阅。", en: "There’s no subscription to manage yet." },
  ALREADY_SUBSCRIBED: { zh: "你已经有一份订阅了，可以在“管理订阅”里查看。", en: "You already have a subscription. You can review it under Manage subscription." },
};

export function getApiErrorMessage(
  error: unknown,
  lang: Lang,
  fallback: string,
): string {
  if (typeof error === "string" && error in messages) {
    return messages[error as ApiErrorCode][lang];
  }
  // Never surface an untranslated server sentence inside the English UI.
  if (lang === "en") return fallback;
  return typeof error === "string" && error.trim() ? error : fallback;
}
