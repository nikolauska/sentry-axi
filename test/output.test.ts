import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatToolResult } from "../src/output.ts";

test("prints markdown verbatim with Sentry tools translated to CLI commands", async () => {
  const markdown = [
    "# Issue ABC",
    "",
    "- Issue event search: Use the Sentry tool `search_issue_events`",
    "- Attachments: `get_event_attachment`",
    "- Breadcrumbs: Use the Sentry tool `get_issue_breadcrumbs`",
    "- Query: `is_unresolved`",
    "- Stats: Use search_events for aggregated statistics",
    "- Link: https://acme.sentry.io/explore/search_events/?field=search_events",
  ].join("\n");
  assert.equal(
    await formatToolResult({ content: [{ type: "text", text: `${markdown}\n` }] }),
    [
      "# Issue ABC",
      "",
      "- Issue event search: Use `sentry-axi issues events`",
      "- Attachments: `sentry-axi attachments list` or `sentry-axi attachments download`",
      "- Breadcrumbs: Use `sentry-axi tools run get_issue_breadcrumbs --arguments '<json>'`",
      "- Query: `is_unresolved`",
      "- Stats: Use `sentry-axi events search` for aggregated statistics",
      "- Link: https://acme.sentry.io/explore/search_events/?field=search_events",
    ].join("\n"),
  );
});

test("truncates long markdown at a line and closes an open code fence", async () => {
  const frames = Array.from(
    { length: 400 },
    (_, index) => `    at Frame.call/${index} (lib/app.ex:${index})`,
  );
  const output = (await formatToolResult(
    { content: [{ type: "text", text: ["# Issue", "```", ...frames, "```"].join("\n") }] },
    { command: "sentry-axi issues view ABC" },
  )) as string;
  const [body, nextSteps] = output.split("\n\n… (truncated, showing ");
  assert.ok(body.endsWith(")\n```"), body.slice(-60));
  assert.match(nextSteps, /^\d+ of \d+ characters\)\n\n## More content\n\n/);
  assert.ok(nextSteps.endsWith("- Run `sentry-axi issues view ABC --full` for complete content"));
  const full = await formatToolResult(
    { content: [{ type: "text", text: frames.join("\n") }] },
    { full: true },
  );
  assert.equal(full, frames.join("\n"));
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

test("compacts list rows and says how to get hidden fields and more rows", async () => {
  const command = "sentry-axi projects list";
  const output = await formatToolResult(
    {
      structuredContent: {
        projects: [{ slug: "web", platform: { name: "node" }, description: "d".repeat(300) }],
        hasMore: true,
      },
    },
    { command, list: true, moreCommand: `${command} --limit <n>` },
  );
  assert.deepEqual(Object.keys(output.projects[0]), ["slug", "description"]);
  assert.match(output.projects[0].description, /truncated, 300 chars total/);
  assert.equal(output.hasMore, true);
  assert.deepEqual(output.help, [
    `More results exist. Run \`${command} --limit <n>\` or narrow the query to see them`,
    `List rows hide nested fields: platform. Run \`${command} --select <fields>\` or \`${command} --full\` to include them`,
    `Run \`${command} --full\` for complete content`,
  ]);
});

test("keeps nested fields in detail results and full list output", async () => {
  const result = { structuredContent: { teams: [{ slug: "core", members: [{ id: 1 }] }] } };
  assert.deepEqual((await formatToolResult(result)).teams, [
    { slug: "core", members: [{ id: 1 }] },
  ]);
  assert.deepEqual((await formatToolResult(result, { list: true, full: true })).teams, [
    { slug: "core", members: [{ id: 1 }] },
  ]);
});

test("points at the next page when Sentry returns a cursor", async () => {
  const output = await formatToolResult(
    { structuredContent: { dashboards: [{ id: "1" }], nextCursor: "0:25:0" } },
    { list: true, nextPageCommand: (cursor) => `sentry-axi dashboards list --cursor ${cursor}` },
  );
  assert.deepEqual(output.help, [
    "Run `sentry-axi dashboards list --cursor 0:25:0` for the next page",
  ]);
});

test("flags a full page as possibly incomplete", async () => {
  const output = await formatToolResult(
    { structuredContent: [{ id: "1" }, { id: "2" }] },
    { limit: 2, moreCommand: "sentry-axi issues search --limit 4" },
  );
  assert.equal(output.count, "2 returned; limit 2 reached, more may exist");
  assert.match(output.help[0], /sentry-axi issues search --limit 4/);
});

test("rejects selections that would print nothing", async () => {
  await assert.rejects(
    formatToolResult(
      { content: [{ type: "text", text: "# Issue\nmarkdown" }] },
      { select: "id", command: "sentry-axi issues view ABC" },
    ),
    /--select needs structured records/,
  );
  await assert.rejects(
    formatToolResult({ structuredContent: [{ id: "1", title: "One" }] }, { select: "nope" }),
    (error) => {
      assert.match(error.message, /--select field not found: nope/);
      assert.deepEqual(error.suggestions, ["Available fields: id, title"]);
      return true;
    },
  );
});

test("states an empty structured response explicitly", async () => {
  assert.deepEqual(await formatToolResult({ structuredContent: {} }), {
    result: "Sentry returned no content",
  });
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
