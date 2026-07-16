import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { runAxiCli } from "axi-sdk-js";

import { authCommand, authHelp } from "./commands/auth.js";
import { resolveMcpUrl } from "./config.js";
import { SentryMcpClient } from "./mcp.js";

export const DESCRIPTION = "Agent-friendly CLI for Sentry MCP workflows";
const { version: VERSION } = createRequire(import.meta.url)("../package.json");

const COMMANDS = {
  auth: authCommand,
};

export async function main(args, context) {
  await runAxiCli({
    argv: args,
    description: DESCRIPTION,
    version: VERSION,
    stdout: context.stdout,
    home: async () => ({ status: "Run `sentry-axi auth login` to connect to Sentry MCP" }),
    commands: COMMANDS,
    getCommandHelp: (command) => command === "auth" ? authHelp() : null,
    resolveContext: () => makeRuntime(context),
    topLevelHelp: topHelp(),
  });
}

export function topHelp() {
  return [
    "sentry-axi - agent-friendly Sentry MCP CLI",
    "",
    "Usage:",
    "  sentry-axi",
    "  sentry-axi auth login",
    "  sentry-axi auth login --manual",
    "  sentry-axi auth finish --code <code>",
    "  sentry-axi auth logout",
    "  sentry-axi --help",
  ].join("\n");
}

async function makeRuntime(context) {
  const url = await resolveMcpUrl(context.env);
  return {
    env: context.env,
    stdout: context.stdout,
    client: context.client ?? new SentryMcpClient({
      url,
      mcpToken: context.env.SENTRY_AXI_MCP_TOKEN,
      sentryToken: context.env.SENTRY_ACCESS_TOKEN,
      authStorePath: context.env.SENTRY_AXI_AUTH_FILE,
    }),
    binPath: executablePath(),
    mcpUrl: url,
  };
}

function executablePath() {
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return process.argv[1] ?? "sentry-axi";
  }
}
