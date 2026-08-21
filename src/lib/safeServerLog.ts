type SafeErrorMetadata = {
  name: string;
  code?: string;
};

export function safeErrorMetadata(error: unknown): SafeErrorMetadata {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      name: error.name || "Error",
      ...(typeof code === "string" ? { code } : {}),
    };
  }

  return { name: "UnknownError" };
}

export function safeValidationIssues(
  issues: Array<{ code: string; path: PropertyKey[] }>,
) {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path.map(String),
  }));
}
