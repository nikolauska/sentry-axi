import test from "node:test";
import assert from "node:assert/strict";

import { formatToolResult } from "../src/output.ts";

test("truncates long MCP text with a full-content hint", async () => {
  const output = await formatToolResult(
    { content: [{ type: "text", text: "x".repeat(1600) }] },
    { command: "sentry-axi issues view ABC" },
  );
  assert.match(output.result, /truncated, 1600 chars total/);
  assert.deepEqual(output.help, ["Run `sentry-axi issues view ABC --full` for complete content"]);
});

test("preserves structured empty results", async () => {
  assert.deepEqual(await formatToolResult({ structuredContent: [] }), {
    count: "0 returned",
    items: [],
  });
});

test("projects selected fields from structured rows", async () => {
  const output = await formatToolResult(
    { structuredContent: [{ id: "1", title: "One", extra: true }] },
    { select: "id,title" },
  );
  assert.deepEqual(output.items, [{ id: "1", title: "One" }]);
});
