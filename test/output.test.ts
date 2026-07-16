import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("requires an output path for binary commands", async () => {
  await assert.rejects(
    formatToolResult({ content: [{ type: "image", data: "aGk=", mimeType: "image/png" }] }),
    /--output is required/,
  );
});

test("writes binary content and reports its path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sentry-axi-"));
  const path = join(directory, "snapshot.png");
  try {
    const output = await formatToolResult(
      { content: [{ type: "image", data: "aGk=", mimeType: "image/png" }] },
      { output: path },
    );
    assert.equal(await readFile(path, "utf8"), "hi");
    assert.equal(output.output, path);
    assert.equal(output.mimeType, "image/png");
  } finally {
    await rm(directory, { recursive: true });
  }
});
