import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SentryMcpClient, SentryOAuthProvider, authorizationHeader } from "../src/mcp.ts";

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

test("OAuth state persists with private permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sentry-axi-oauth-"));
  const storePath = join(dir, "oauth.json");
  const provider = new SentryOAuthProvider({ storePath });
  const first = await provider.state();
  assert.equal(await provider.state(), first);
  await chmod(storePath, 0o666);
  await provider.saveTokens({ access_token: "updated", token_type: "Bearer" });
  assert.equal((await stat(storePath)).mode & 0o777, 0o600);
  assert.equal((await readJson(storePath)).state, first);
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
