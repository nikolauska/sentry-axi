import { CATALOG } from "./catalog.ts";

export const SKILL_DESCRIPTION =
  "Operate Sentry through the sentry-axi CLI: issues, events, traces, replays, releases, projects, alerts, dashboards, monitors, profiles, snapshots, and Sentry docs. Use whenever a task needs Sentry investigation or an explicit Sentry mutation. Do not use for other observability providers.";

export function createSkillMarkdown(): string {
  const groups = Object.entries(CATALOG)
    .map(([group, actions]) => `- ${group}: ${Object.keys(actions).join(", ")}`)
    .join("\n");

  return `---
name: sentry-axi
description: ${JSON.stringify(SKILL_DESCRIPTION)}
---

# sentry-axi

Agent-friendly wrapper around the configured Sentry MCP server. Prefer it over raw Sentry MCP calls.

Check whether \`sentry-axi\` is installed before using it. If missing, ask the user to install it globally with \`npm install -g @nikolauska/sentry-axi\`. Node.js 24 or newer is required.

## Workflow

1. Run \`sentry-axi\` with no arguments to inspect authentication and repository context.
2. If needed, run \`sentry-axi auth login\`. Never print access tokens or saved OAuth credentials.
3. Bind a Git repository with \`sentry-axi init --organization <slug> --project <slug>\`. Commands then use \`.sentry-project\` defaults; pass \`--all-projects\` only when broad scope is intended.
4. Start with compact search or list commands, then drill into a specific issue, event, trace, replay, profile, or resource.
5. Use \`--select <field,...>\` to narrow structured results and \`--full\` only when truncation hides needed content.
6. Binary attachment and snapshot-image commands require \`--output <path>\`.
7. Before creating or updating Sentry data, confirm the exact target unless the user already requested that mutation. After an uncertain transport failure, inspect the target before retrying.

## Commands

${groups}

Use \`sentry-axi --help\`, \`sentry-axi <group> --help\`, or \`sentry-axi <group> <action> --help\` for flags. Use \`sentry-axi tools search <query>\` and \`sentry-axi tools run <name> --arguments '<json>'\` for server tools not yet exposed directly.
`;
}
