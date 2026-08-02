import test from "node:test";
import assert from "node:assert/strict";

import { DESCRIPTION, topHelp } from "../src/cli.ts";

test("describes the Sentry AXI", () => {
  assert.match(DESCRIPTION, /Sentry MCP/);
  assert.match(topHelp(), /sentry-axi --help/);
  assert.match(topHelp(), /sentry-axi setup hooks/);
});
