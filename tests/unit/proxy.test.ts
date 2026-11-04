import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
// the proxy docs name this unstable_doesProxyMatch; Next 16.4 still ships it under the old name
import { unstable_doesMiddlewareMatch as doesProxyMatch } from "next/experimental/testing/server";

// Auth.js doesn't load outside Next; stand in for its auth() wrapper, which decodes the session
// cookie into req.auth and then calls the proxy's handler.
const nextAuth = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    nextAuth.config = config;
    return { auth: (handler: (req: unknown) => unknown) => handler };
  },
}));

import { authConfig } from "@/auth.config";
import { config, proxy } from "@/proxy";

type Handler = (req: NextRequest & { auth: unknown }) => Response | undefined;
const run = (url: string, session: unknown) =>
  (proxy as unknown as Handler)(Object.assign(new NextRequest(url), { auth: session }));

describe("src/proxy.ts", () => {
  it("uses the shared auth config, without the database adapter", () => {
    expect(nextAuth.config).toBe(authConfig);
  });

  it("sends a signed-out reader to /login with the page they asked for", () => {
    const response = run("https://dream-reel.example/journal/2026-11-04?mode=chat", null);
    expect(response?.status).toBe(302);
    const target = new URL(response!.headers.get("location")!);
    expect(target.origin + target.pathname).toBe("https://dream-reel.example/login");
    expect(target.searchParams.get("callbackUrl")).toBe("/journal/2026-11-04");
  });

  it("lets a signed-in reader through untouched", () => {
    expect(run("https://dream-reel.example/archive", { user: { id: "7" } })).toBeUndefined();
  });

  it.each(["/journal", "/journal/2026-11-04", "/archive", "/archive/12", "/account", "/account/billing", "/morning-pages", "/morning-pages/2026-11-04"])(
    "guards %s", (url) => {
      expect(doesProxyMatch({ config, url })).toBe(true);
    },
  );

  it.each(["/", "/login", "/pricing", "/blog/dreams-and-consciousness", "/api/dreams", "/api/auth/session", "/_next/static/chunk.js"])(
    "leaves %s public", (url) => {
      expect(doesProxyMatch({ config, url })).toBe(false);
    },
  );
});
