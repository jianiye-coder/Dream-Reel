import type { Lang } from "@/lib/i18n";

export const API_ERROR_CODES = {
  unauthorized: "UNAUTHORIZED",
  invalidRequest: "INVALID_REQUEST",
  quotaExceeded: "QUOTA_EXCEEDED",
  configurationError: "CONFIGURATION_ERROR",
  upstreamError: "UPSTREAM_ERROR",
  timeout: "TIMEOUT",
  invalidResponse: "INVALID_RESPONSE",
  notFound: "NOT_FOUND",
  internalError: "INTERNAL_ERROR",
} as const;

export type ApiErrorCode = typeof API_ERROR_CODES[keyof typeof API_ERROR_CODES];

const messages: Record<ApiErrorCode, Record<Lang, string>> = {
  UNAUTHORIZED: { zh: "请先登录。", en: "Please sign in first." },
  INVALID_REQUEST: { zh: "请求参数不合法。", en: "The request is invalid." },
  QUOTA_EXCEEDED: { zh: "本月额度已用完，请升级 Plus 或下月继续。", en: "Your monthly limit is used up. Upgrade to Plus or try again next month." },
  CONFIGURATION_ERROR: { zh: "服务尚未配置，请联系管理员。", en: "This service is not configured. Please contact support." },
  UPSTREAM_ERROR: { zh: "AI 服务暂时不可用，请稍后重试。", en: "The AI service is temporarily unavailable. Please try again." },
  TIMEOUT: { zh: "请求超时，请稍后重试。", en: "The request timed out. Please try again." },
  INVALID_RESPONSE: { zh: "服务返回了无法解析的结果，请重试。", en: "The service returned an invalid response. Please try again." },
  NOT_FOUND: { zh: "没有找到对应记录。", en: "The requested record was not found." },
  INTERNAL_ERROR: { zh: "服务暂时出现错误，请稍后重试。", en: "Something went wrong. Please try again." },
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
