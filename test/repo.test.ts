import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initCommand } from "../src/commands/init.ts";
import {
  endpointConstraints,
  parseOrganizations,
  parseProjectSlugs,
  readRepoBinding,
} from "../src/repo.ts";

test("parses hosted endpoint constraints", () => {
  assert.deepEqual(endpointConstraints("https://mcp.sentry.dev/mcp/acme/web"), {
    organization: "acme",
    project: "web",
  });
  assert.deepEqual(endpointConstraints("https://mcp.sentry.dev/mcp"), {});
});

test("parses organization and project discovery output", () => {
  assert.deepEqual(
    parseOrganizations("## **acme**\n\n**Web URL:** x\n**Region URL:** https://us.sentry.io"),
    [{ slug: "acme", regionUrl: "https://us.sentry.io" }],
  );
  assert.deepEqual(parseProjectSlugs("- **web**\n- **worker**\n"), ["web", "worker"]);
});

test("initializes a canonical repository binding", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "sentry-axi-repo-"));
  await mkdir(join(cwd, ".git"));
  const calls = [];
  const runtime = {
    cwd,
    mcpUrl: "https://mcp.sentry.dev/mcp",
    client: {
      listTools: async () => [{ name: "find_organizations" }, { name: "find_projects" }],
      callTool: async (name, args) => {
        calls.push([name, args]);
        const text =
          name === "find_organizations"
            ? "## **acme**\n\n**Web URL:** x\n**Region URL:** https://us.sentry.io"
            : "- **web**\n";
        return { content: [{ type: "text", text }] };
      },
    },
  };
  const output = await initCommand(["--organization", "acme", "--project", "web"], runtime);
  assert.equal(output.binding, "initialized");
  assert.deepEqual(await readRepoBinding(cwd), {
    organization: "acme",
    project: "web",
    regionUrl: "https://us.sentry.io",
  });
  assert.equal(JSON.parse(await readFile(join(cwd, ".sentry-project"), "utf8")).project, "web");
  assert.equal(calls.length, 2);
});

test("scoped endpoint rejects a conflicting binding", async () => {
  await assert.rejects(
    () =>
      initCommand(["--organization", "other", "--project", "web"], {
        cwd: "/tmp",
        mcpUrl: "https://mcp.sentry.dev/mcp/acme/web",
        client: {},
      }),
    /Git repository|conflicts/,
  );
});
