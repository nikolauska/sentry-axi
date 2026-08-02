import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_MCP_URL, resolveMcpUrl } from "../src/config.ts";

test("uses an explicit endpoint override or the Sentry default", () => {
  assert.equal(
    resolveMcpUrl({ SENTRY_AXI_MCP_URL: "https://override.example/mcp" }),
    "https://override.example/mcp",
  );
  assert.equal(resolveMcpUrl({}), DEFAULT_MCP_URL);
});
