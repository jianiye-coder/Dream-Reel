import { createHash } from "crypto";
import { ensureSchema, getPool } from "./db";

export type AuthRateLimitAction = "login" | "register" | "password";

const POLICY: Record<AuthRateLimitAction, { windowSeconds: number; identifierLimit: number; ipLimit: number }> = {
  login: { windowSeconds: 15 * 60, identifierLimit: 10, ipLimit: 30 },
  register: { windowSeconds: 60 * 60, identifierLimit: 3, ipLimit: 8 },
  password: { windowSeconds: 15 * 60, identifierLimit: 5, ipLimit: 15 },
};

function digest(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function getTrustedClientIp(headers: Headers) {
  if (process.env.VERCEL === "1") {
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

function scopeKeys(action: AuthRateLimitAction, identifier: string, ipAddress: string) {
  return [
    `${action}:identifier:${digest(identifier)}`,
    `${action}:ip:${digest(ipAddress)}`,
  ];
}

export async function consumeAuthAttempt(
  action: AuthRateLimitAction,
  identifier: string,
  ipAddress: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  await ensureSchema();
  const policy = POLICY[action];
  const limits = [policy.identifierLimit, policy.ipLimit];
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    let allowed = true;
    for (const [index, key] of scopeKeys(action, identifier, ipAddress).entries()) {
      const result = await client.query<{ request_count: number }>(
        `
          INSERT INTO auth_rate_limits (scope_key, window_start, request_count)
          VALUES ($1, NOW(), 1)
          ON CONFLICT (scope_key)
          DO UPDATE SET
            window_start = CASE
              WHEN auth_rate_limits.window_start <= NOW() - ($2 * INTERVAL '1 second') THEN NOW()
              ELSE auth_rate_limits.window_start
            END,
            request_count = CASE
              WHEN auth_rate_limits.window_start <= NOW() - ($2 * INTERVAL '1 second') THEN 1
              ELSE auth_rate_limits.request_count + 1
            END
          RETURNING request_count
        `,
        [key, policy.windowSeconds],
      );
      if (Number(result.rows[0]?.request_count ?? 0) > limits[index]) allowed = false;
    }
    await client.query("COMMIT");
    return { allowed, retryAfterSeconds: policy.windowSeconds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function clearAuthAttempts(
  action: AuthRateLimitAction,
  identifier: string,
  ipAddress: string,
) {
  await ensureSchema();
  await getPool().query(
    "DELETE FROM auth_rate_limits WHERE scope_key = ANY($1::text[])",
    [scopeKeys(action, identifier, ipAddress)],
  );
}
