import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CATALOG, MAPPED_TOOL_NAMES } from "../src/catalog.ts";
import { catalogCommand } from "../src/commands/catalog.ts";
import type { InputRecord, McpResult, Runtime } from "../src/types.ts";

type Call = [string, InputRecord];

const EXPECTED = [
  "add_issue_note",
  "add_team_to_project",
  "analyze_issue_with_seer",
  "create_dsn",
  "create_project",
  "create_team",
  "execute_sentry_tool",
  "find_alert_rules",
  "find_dashboards",
  "find_dsns",
  "find_monitors",
  "find_organizations",
  "find_projects",
  "find_releases",
  "find_teams",
  "get_ai_conversation_details",
  "get_alert_rule",
  "get_dashboard_details",
  "get_doc",
  "get_event_attachment",
  "get_event_stacktrace",
  "get_issue_activity",
  "get_issue_details",
  "get_issue_tag_values",
  "get_issue_user_reports",
  "get_latest_base_snapshot",
  "get_monitor_details",
  "get_profile",
  "get_profile_details",
  "get_release_details",
  "get_replay_details",
  "get_sentry_resource",
  "get_snapshot",
  "get_snapshot_image",
  "get_trace_details",
  "remove_team_from_project",
  "search_ai_conversations",
  "search_docs",
  "search_events",
  "search_issue_events",
  "search_issues",
  "search_sentry_tools",
  "update_dsn",
  "update_issue",
  "update_project",
  "whoami",
].sort();

test("maps every Sentry tool in the v1 baseline exactly once", () => {
  assert.deepEqual([...MAPPED_TOOL_NAMES].sort(), EXPECTED);
  assert.equal(new Set(MAPPED_TOOL_NAMES).size, EXPECTED.length);
});

test("routes catalog-only tools through execute_sentry_tool", async () => {
  const cwd = await repository();
  const calls: Call[] = [];
  const runtime = fakeRuntime(cwd, calls, ["execute_sentry_tool"]);
  const output = await catalogCommand("releases")(
    ["view", "1.2.3", "--include-commits=false", "--limit", "5"],
    runtime,
  );
  assert.equal((output as Record<string, unknown>).result, "ok");
  assert.deepEqual(calls[0], [
    "execute_sentry_tool",
    {
      name: "get_release_details",
      arguments: {
        organizationSlug: "acme",
        regionUrl: "https://us.sentry.io",
        releaseVersion: "1.2.3",
        projectSlugOrId: "web",
        includeCommits: false,
        limit: 5,
      },
    },
  ]);
});

test("calls direct tools directly and parses repeated fields", async () => {
  const cwd = await repository();
  const calls: Call[] = [];
  const runtime = fakeRuntime(cwd, calls, ["search_events"]);
  await catalogCommand("events")(
    [
      "search",
      "errors today",
      "--dataset",
      "errors",
      "--fields",
      "count()",
      "--fields",
      "title",
      "--limit",
      "10",
    ],
    runtime,
  );
  assert.deepEqual(calls[0][1], {
    organizationSlug: "acme",
    regionUrl: "https://us.sentry.io",
    projectSlug: "web",
    query: "errors today",
    dataset: "errors",
    fields: ["count()", "title"],
    limit: 10,
  });
});

test("rejects invalid enums and missing required arguments before MCP calls", async () => {
  const cwd = await repository();
  const runtime = fakeRuntime(cwd, [], ["search_events"]);
  await assert.rejects(
    () => catalogCommand("events")(["search", "--dataset", "wrong"], runtime),
    /must be one of/,
  );
  await assert.rejects(() => catalogCommand("docs")(["view"], runtime), /--path is required/);
});

test("resolves binary output paths against the runtime directory", async () => {
  const cwd = await repository();
  const runtime = fakeRuntime(cwd, [], ["get_event_attachment"], {
    content: [{ type: "image", data: "aGk=", mimeType: "image/png" }],
  });
  try {
    const output = await catalogCommand("attachments")(
      ["download", "event-1", "--attachment-id", "attachment-1", "--output", "artifact.bin"],
      runtime,
    );
    const path = join(cwd, "artifact.bin");
    assert.equal(await readFile(path, "utf8"), "hi");
    assert.equal((output as Record<string, unknown>).output, path);
  } finally {
    await rm(cwd, { recursive: true });
  }
});

test("the registry exposes every planned command group", () => {
  assert.deepEqual(Object.keys(CATALOG), [
    "organizations",
    "projects",
    "teams",
    "dsns",
    "issues",
    "events",
    "attachments",
    "traces",
    "replays",
    "releases",
    "dashboards",
    "monitors",
    "alerts",
    "docs",
    "profiles",
    "resources",
    "snapshots",
    "conversations",
    "tools",
  ]);
});

async function repository(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "sentry-axi-catalog-"));
  await mkdir(join(cwd, ".git"));
  await writeFile(
    join(cwd, ".sentry-project"),
    JSON.stringify({ organization: "acme", project: "web", regionUrl: "https://us.sentry.io" }),
  );
  return cwd;
}

function fakeRuntime(
  cwd: string,
  calls: Call[],
  tools: string[],
  result: McpResult = { content: [{ type: "text", text: "ok" }] },
): Runtime {
  return {
    cwd,
    env: process.env,
    stdout: { write: () => true },
    mcpUrl: "https://mcp.sentry.dev/mcp",
    client: {
      listTools: async () => tools.map((name) => ({ name })),
      callTool: async (name: string, args: InputRecord) => {
        calls.push([name, args]);
        return result;
      },
    },
  };
}
