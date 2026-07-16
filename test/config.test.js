import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_MCP_URL, extractSentryMcpUrl, resolveMcpUrl } from "../src/config.js";

test("reads only the Sentry Codex MCP table", () => {
  const text = `
[mcp_servers.other]
url = "https://wrong.example/mcp"

[mcp_servers.sentry]
url = "https://sentry.example/mcp/acme/app"
`;
  assert.equal(extractSentryMcpUrl(text), "https://sentry.example/mcp/acme/app");
});

test("environment URL overrides config lookup", async () => {
  assert.equal(await resolveMcpUrl({ SENTRY_AXI_MCP_URL: "https://override.example/mcp" }), "https://override.example/mcp");
  assert.equal(await resolveMcpUrl({ CODEX_CONFIG: "/missing" }), DEFAULT_MCP_URL);
});
