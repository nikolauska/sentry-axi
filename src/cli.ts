import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { runAxiCli } from "axi-sdk-js";
import type { AxiCliCommand } from "axi-sdk-js";

import { authCommand, authHelp } from "./commands/auth.ts";
import { catalogCommand, groupHelp } from "./commands/catalog.ts";
import { homeCommand } from "./commands/home.ts";
import { initCommand, initHelp } from "./commands/init.ts";
import { CATALOG } from "./catalog.ts";
import { resolveMcpUrl } from "./config.ts";
import { SentryMcpClient } from "./mcp.ts";
import type { MainContext, Renderable, Runtime } from "./types.ts";

export const DESCRIPTION = "Agent-friendly CLI for Sentry MCP workflows";
const { version: VERSION } = createRequire(import.meta.url)("../package.json");

type RuntimeCommand = (args: string[], runtime: Runtime) => Renderable | Promise<Renderable>;

const COMMANDS: Record<string, RuntimeCommand> = {
  auth: authCommand,
  init: initCommand,
  ...Object.fromEntries(Object.keys(CATALOG).map((group) => [group, catalogCommand(group)])),
};

export async function main(args: string[], context: MainContext): Promise<void> {
  await runAxiCli<Runtime>({
    argv: args,
    description: DESCRIPTION,
    version: VERSION,
    stdout: context.stdout,
    home: withCleanup(async (_args, runtime) => homeCommand(runtime)),
    commands: Object.fromEntries(
      Object.entries(COMMANDS).map(([name, command]) => [name, withCleanup(command)]),
    ),
    getCommandHelp: (command) =>
      (({ auth: authHelp, init: initHelp }) as Record<string, () => string>)[command]?.() ??
      (CATALOG[command] ? groupHelp(command) : null),
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
    "  sentry-axi init --organization <slug> --project <slug>",
    '  sentry-axi issues search --query "unresolved errors"',
    '  sentry-axi tools search "snapshot images"',
    "  sentry-axi auth login",
    "  sentry-axi auth login --manual",
    "  sentry-axi auth finish --code <code>",
    "  sentry-axi auth logout",
    "  sentry-axi --help",
    "",
    `Commands: auth, init, ${Object.keys(CATALOG).join(", ")}`,
  ].join("\n");
}

function withCleanup(handler: RuntimeCommand): AxiCliCommand<Runtime> {
  return async (args, runtime) => {
    if (!runtime) throw new Error("Sentry AXI runtime was not initialized");
    try {
      return await handler(args, runtime);
    } finally {
      await runtime?.client?.close?.();
    }
  };
}

async function makeRuntime(context: MainContext): Promise<Runtime> {
  const url = await resolveMcpUrl(context.env);
  return {
    cwd: context.cwd,
    env: context.env,
    stdout: context.stdout,
    client:
      context.client ??
      new SentryMcpClient({
        url,
        mcpToken: context.env.SENTRY_AXI_MCP_TOKEN,
        sentryToken: context.env.SENTRY_ACCESS_TOKEN,
        authStorePath: context.env.SENTRY_AXI_AUTH_FILE,
      }),
    binPath: executablePath(),
    mcpUrl: url,
  };
}

function executablePath(): string {
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return process.argv[1] ?? "sentry-axi";
  }
}
