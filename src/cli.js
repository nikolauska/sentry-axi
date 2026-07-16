import { runAxiCli } from "axi-sdk-js";

export const DESCRIPTION = "Agent-friendly CLI for Sentry MCP workflows";

export async function main(args, context) {
  await runAxiCli({
    argv: args,
    description: DESCRIPTION,
    version: "0.1.0",
    stdout: context.stdout,
    home: async () => ({ status: "Sentry MCP support is not configured yet" }),
    commands: {},
    topLevelHelp: topHelp(),
  });
}

export function topHelp() {
  return [
    "sentry-axi - agent-friendly Sentry MCP CLI",
    "",
    "Usage:",
    "  sentry-axi",
    "  sentry-axi --help",
  ].join("\n");
}
