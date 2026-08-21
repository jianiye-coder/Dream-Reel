import NextAuth, { CredentialsSignin } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import PostgresAdapter from "@auth/pg-adapter";
import { ensureSchema, getPool } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { normalizeEmail } from "@/lib/email";
import { clearAuthAttempts, consumeAuthAttempt, getTrustedClientIp } from "@/lib/authRateLimit";

const DUMMY_PASSWORD_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.ou7q9r7w7N1Gq6V4ZJ6f4WnT5fYQw8K";

class RateLimitedCredentialsError extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({
  email: z.string().transform(normalizeEmail).pipe(z.string().email()),
  password: z.string().min(6),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PostgresAdapter(getPool()),
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        await ensureSchema();
        const ipAddress = getTrustedClientIp(request.headers);
        const rateLimit = await consumeAuthAttempt("login", parsed.data.email, ipAddress);
        if (!rateLimit.allowed) throw new RateLimitedCredentialsError();

        const pool = getPool();
        const { rows } = await pool.query(
          `SELECT id, name, email, image, password_hash FROM users WHERE email = $1`,
          [parsed.data.email],
        );

        const user = rows[0] as
          | { id: number; name: string; email: string; image: string | null; password_hash: string | null }
          | undefined;

        const valid = await bcrypt.compare(
          parsed.data.password,
          user?.password_hash || DUMMY_PASSWORD_HASH,
        );
        if (!user || !user.password_hash || !valid) return null;

        await clearAuthAttempts("login", parsed.data.email, ipAddress);

        return { id: String(user.id), name: user.name, email: user.email, image: user.image };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = String(token.id);
      }
      return session;
    },
  },
});
