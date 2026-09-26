export const SKILL_DESCRIPTION =
  "Operate Sentry through the sentry-axi CLI: issues, events, traces, replays, releases, projects, alerts, dashboards, monitors, profiles, snapshots, and Sentry docs. Use whenever a task needs Sentry investigation or an explicit Sentry mutation. Do not use for other observability providers.";

// Usage lives in `sentry-axi --help` so it always matches the installed version; the skill only
// routes the agent there.
export function createSkillMarkdown(): string {
  return `---
name: sentry-axi
description: ${JSON.stringify(SKILL_DESCRIPTION)}
---

# sentry-axi

Agent-friendly wrapper around the configured Sentry MCP server. Prefer it over raw Sentry MCP calls.

Use the standalone \`sentry-axi\` binary. Check that it is installed before running it; if missing, ask the user to install it globally with \`npm install -g @nikolauska/sentry-axi\`. Node.js 24 or newer is required.

Run \`sentry-axi --help\` before first use and follow it for workflow, output, and safety rules. Use \`sentry-axi <group> --help\` and \`sentry-axi <group> <action> --help\` for actions and flags.
`;
}
