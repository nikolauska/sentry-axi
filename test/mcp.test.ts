import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { homeCommand } from "../src/commands/home.ts";
import {
  AuthRequiredError,
  SentryMcpClient,
  SentryOAuthProvider,
  authorizationHeader,
} from "../src/mcp.ts";
import type { Runtime } from "../src/types.ts";

test("uses OAuth only when no token is configured", () => {
  assert.ok(
    new SentryMcpClient({ url: "https://mcp.sentry.dev/mcp" }).authProvider instanceof
      SentryOAuthProvider,
  );
  assert.equal(
    new SentryMcpClient({ url: "https://mcp.sentry.dev/mcp", sentryToken: "secret" }).authProvider,
    null,
  );
});

test("uses distinct authorization schemes", () => {
  assert.equal(authorizationHeader({ mcpToken: "mcp" }), "Bearer mcp");
  assert.equal(authorizationHeader({ sentryToken: "sentry" }), "Sentry-Bearer sentry");
  assert.equal(authorizationHeader({}), null);
  assert.throws(
    () => authorizationHeader({ mcpToken: "mcp", sentryToken: "sentry" }),
    /Only one token/,
  );
});

test("rejects ambiguous token configuration", () => {
  assert.throws(
    () =>
      new SentryMcpClient({ url: "https://mcp.sentry.dev/mcp", mcpToken: "a", sentryToken: "b" }),
    /cannot both be set/,
  );
});

test("rejects an invalid MCP URL with a recovery hint", async () => {
  const client = new SentryMcpClient({ url: "not-a-url" });
  await assert.rejects(client.connect(), /Sentry MCP URL is invalid/);
});

test("translates transport failures without echoing the response body", async () => {
  const cases: Array<[typeof fetch, string, RegExp, RegExp]> = [
    [
      async () => new Response("<html><body>proxy error</body></html>", { status: 502 }),
      "BACKEND_ERROR",
      /^Sentry MCP endpoint failed with HTTP 502$/,
      /Retry later/,
    ],
    [
      async () => new Response("denied", { status: 401 }),
      "AUTH_ERROR",
      /^Sentry MCP rejected the credentials \(HTTP 401\)$/,
      /SENTRY_AXI_MCP_TOKEN/,
    ],
    [
      async () => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      },
      "CONNECTION_ERROR",
      /^Could not reach the Sentry MCP endpoint at mcp\.example\.test$/,
      /SENTRY_AXI_MCP_URL/,
    ],
  ];
  for (const [fetchImpl, code, message, suggestion] of cases) {
    const client = new SentryMcpClient({
      url: "https://mcp.example.test/mcp",
      mcpToken: "secret",
      fetchImpl,
    });
    await assert.rejects(
      client.listTools(),
      (error: Error & { code: string; suggestions: string[] }) => {
        assert.equal(error.code, code);
        assert.match(error.message, message);
        assert.ok(
          error.suggestions.some((item) => suggestion.test(item)),
          error.suggestions.join("|"),
        );
        assert.doesNotMatch(JSON.stringify(error.suggestions), /secret|<html/);
        return true;
      },
    );
  }
});

test("home suggests login only when authorization is missing", async () => {
  const runtime = (callTool: Runtime["client"]["callTool"]): Runtime => ({
    cwd: tmpdir(),
    env: {},
    stdout: { write: () => true },
    mcpUrl: "https://mcp.sentry.dev/mcp",
    client: { listTools: async () => [{ name: "whoami" }], callTool },
  });
  const signedIn = await homeCommand(
    runtime(async () => ({ content: [{ type: "text", text: "You are Test User" }] })),
  );
  assert.equal(signedIn.identity, "You are Test User");
  assert.ok(!(signedIn.help as string[]).some((item) => item.includes("auth login")));

  const signedOut = await homeCommand(
    runtime(async () => {
      throw new AuthRequiredError(null);
    }),
  );
  assert.equal(signedOut.code, "AUTH_REQUIRED");
  assert.equal((signedOut.help as string[])[0], "Run `sentry-axi auth login`");
});

test("OAuth state is fresh per authorization and stored privately", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sentry-axi-oauth-"));
  const storePath = join(dir, "oauth.json");
  const provider = new SentryOAuthProvider({ storePath });
  const first = await provider.state();
  const second = await provider.state();
  assert.notEqual(second, first);
  await chmod(storePath, 0o666);
  await provider.saveTokens({ access_token: "updated", token_type: "Bearer" });
  assert.equal((await stat(storePath)).mode & 0o777, 0o600);
  assert.equal((await readJson(storePath)).state, second);
});

test("OAuth logout is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sentry-axi-oauth-"));
  const provider = new SentryOAuthProvider({ storePath: join(dir, "oauth.json") });
  await provider.saveTokens({ access_token: "secret", token_type: "Bearer" });
  assert.equal(await provider.deleteStore(), true);
  assert.equal(await provider.deleteStore(), false);
});

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    assert.fail(`Failed to parse OAuth store: ${String(error)}`);
  }
}
