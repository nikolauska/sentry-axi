import test from "node:test";
import assert from "node:assert/strict";

import { DESCRIPTION, topHelp } from "../src/cli.js";

test("describes the Sentry AXI", () => {
  assert.match(DESCRIPTION, /Sentry MCP/);
  assert.match(topHelp(), /sentry-axi --help/);
});
