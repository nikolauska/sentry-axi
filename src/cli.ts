import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import {
  AxiError,
  installSessionStartHooks,
  runAxiCli,
  sessionStartHookStatus,
  uninstallSessionStartHooks,
} from "axi-sdk-js";
import type { AxiCliCommand } from "axi-sdk-js";

import { usage } from "./args.ts";
import { authCommand, authHelp } from "./commands/auth.ts";
import { catalogCommand } from "./commands/catalog.ts";
import { homeCommand } from "./commands/home.ts";
import { initCommand, initHelp } from "./commands/init.ts";
import { CATALOG } from "./catalog.ts";
import { resolveMcpUrl } from "./config.ts";
import { SentryMcpClient } from "./mcp.ts";
import type { MainContext, Renderable, Runtime } from "./types.ts";

export const DESCRIPTION = "Agent-friendly CLI for Sentry MCP workflows";
const { version: VERSION } = createRequire(import.meta.url)("../package.json");
const HOOK_MARKER = "sentry-axi";
const SETUP_ACTIONS = ["install", "status", "remove"];

type RuntimeCommand = (args: string[], runtime: Runtime) => Renderable | Promise<Renderable>;

const COMMANDS: Record<string, RuntimeCommand> = {
  auth: authCommand,
  init: initCommand,
  setup: setupCommand,
  ...Object.fromEntries(Object.keys(CATALOG).map((group) => [group, catalogCommand(group)])),
};

export async function run(args: string[], runtime: Runtime): Promise<Renderable> {
  const [command, ...rest] = args;
  if (!command) return homeCommand(runtime);
  const handler = COMMANDS[command];
  if (!handler) throw usage(`unknown command: ${command}`);
  return handler(rest, runtime);
}

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
    // Catalog groups are deliberately absent: the SDK calls this for any `--help` after the
    // command name, and returning group help here would hide `<group> <action> --help`.
    getCommandHelp: (command) =>
      (({ auth: authHelp, init: initHelp, setup: setupHelp }) as Record<string, () => string>)[
        command
      ]?.(),
    renderUnknownCommand: (command) =>
      [
        `error: ${JSON.stringify(`Unknown command: ${command}`)}`,
        "code: VALIDATION_ERROR",
        "help[1]: Run `sentry-axi --help` to list commands",
        "",
      ].join("\n"),
    resolveContext: () => makeRuntime(context),
    topLevelHelp: topHelp(),
  });
}

// Top-level help is the single usage guide: the agent skill only points here, so workflow,
// output conventions, and safety rules must live in this text.
export function topHelp() {
  const groups: Array<[string, string]> = [
    ...Object.entries(CATALOG).map(([group, actions]): [string, string] => [
      group,
      Object.keys(actions).join(", "),
    ]),
    ["auth", "login, finish, logout, whoami"],
    ["init", "bind this Git repository to an organization and project"],
    ["setup", "hooks, hooks status, hooks remove"],
  ];
  const width = Math.max(...groups.map(([group]) => group.length));
  return [
    "sentry-axi - agent-friendly Sentry MCP CLI",
    "",
    "Usage:",
    "  sentry-axi                            show endpoint, sign-in, and repository scope",
    "  sentry-axi <group> <action> [flags]",
    "  sentry-axi <group> --help             list a group's actions",
    "  sentry-axi <group> <action> --help    list an action's flags",
    "",
    "Getting started:",
    "  1. Run `sentry-axi` to check sign-in and scope.",
    "  2. Run `sentry-axi auth login` if not signed in. It waits up to 5 minutes for the browser",
    "     callback; if the shell cannot wait, run `sentry-axi auth login --manual`, have the user",
    "     open the URL, then run `sentry-axi auth finish --code <code>`.",
    "  3. Run `sentry-axi init --organization <slug> --project <slug>` with exact slugs to save",
    "     repository defaults in .sentry-project.",
    '  4. Start with a search or list, e.g. `sentry-axi issues search "unresolved errors"`, then',
    "     open one result, e.g. `sentry-axi issues view <issue-id>`.",
    "",
    "Results:",
    "  - Structured results are TOON. Errors carry `error`, `code`, and `help`; follow the `help` commands.",
    "  - Sentry's markdown answers print as markdown; tool mentions are rewritten to sentry-axi",
    "    commands, and a `## More content` list ends truncated output.",
    "  - List rows show simple fields only. `help` names hidden fields and how to get more rows.",
    "  - `--select <field,...>` keeps chosen fields; `--full` shows complete values and every field.",
    "  - Commands default to the .sentry-project scope; `--all-projects` searches every project.",
    "  - Attachment downloads and snapshot images require `--output <path>`.",
    "  - `tools search <query>` and `tools run <name> --arguments '<json>'` reach server tools",
    "    that have no direct command.",
    "",
    "Rules:",
    "  - Confirm the exact target before creating or updating data unless the user asked for it.",
    "  - After an uncertain failure on a create or update, inspect the target before retrying.",
    "  - Never print access tokens or saved OAuth credentials.",
    "  - Run `sentry-axi setup hooks` only when the user asks for session hooks.",
    "",
    "Groups:",
    ...groups.map(([group, actions]) => `  ${group.padEnd(width)}  ${actions}`),
  ].join("\n");
}

function setupCommand(args: string[]): Renderable {
  const [target, action = "install", ...extra] = args;
  if (target !== "hooks" || extra.length > 0 || !SETUP_ACTIONS.includes(action)) {
    throw usage("setup expects `hooks`, `hooks status`, or `hooks remove`", [
      "Run `sentry-axi setup --help`",
    ]);
  }
  const before = hookReport();
  const errors: string[] = [];
  const onError = (message: string) => errors.push(message);
  if (action === "install")
    installSessionStartHooks({ marker: HOOK_MARKER, binaryNames: [HOOK_MARKER], onError });
  if (action === "remove") uninstallSessionStartHooks({ marker: HOOK_MARKER, onError });
  if (errors.length > 0) {
    throw new AxiError(errors.join("; "), "BACKEND_ERROR", [
      `Run \`sentry-axi setup hooks ${action}\` after fixing the reported files`,
    ]);
  }

  // The SDK skips installation silently for source checkouts and unknown launchers,
  // so success is reported only from what is actually on disk afterwards.
  const after = hookReport();
  const hooks = Object.fromEntries(
    Object.entries(after.hosts).map(([host, item]) => [
      host,
      `${item.installed ? "installed" : "not installed"} (${item.path})`,
    ]),
  );
  const installed = Object.entries(after.hosts).filter(([, item]) => item.installed);
  const codexFeature = `[features] hooks = ${after.codexFeatureEnabled} in ${after.codexFeaturePath}`;

  if (action === "status") {
    return {
      hooks,
      codexFeature,
      help: [
        installed.length > 0
          ? "Run `sentry-axi setup hooks remove` to uninstall"
          : "Run `sentry-axi setup hooks` to install",
      ],
    };
  }
  if (action === "remove") {
    if (installed.length > 0) {
      throw new AxiError(
        `session hooks are still installed for: ${installed.map(([host]) => host).join(", ")}`,
        "BACKEND_ERROR",
        ["Remove the `sentry-axi` SessionStart entries from the listed files manually"],
      );
    }
    const wasInstalled = Object.values(before.hosts).some((item) => item.installed);
    return {
      setup: wasInstalled ? "hooks removed" : "hooks already absent",
      hooks,
      note: `${codexFeature} is left unchanged because other tools may rely on it`,
    };
  }
  const missing = Object.entries(after.hosts).filter(([, item]) => !item.installed);
  if (missing.length > 0) {
    throw new AxiError(
      `session hooks were not installed for: ${missing.map(([host]) => host).join(", ")}`,
      "BACKEND_ERROR",
      ["Run `sentry-axi setup hooks` from the globally installed binary, not from source or npx"],
    );
  }
  return {
    setup: "hooks installed",
    hooks,
    codexFeature,
    help: ["Run `sentry-axi setup hooks remove` to uninstall"],
  };
}

function hookReport() {
  const status = sessionStartHookStatus({ marker: HOOK_MARKER });
  const home = homedir();
  // Home-relative paths keep the report short and avoid echoing the user's account path.
  const display = (path: string) => (path.startsWith(home) ? `~${path.slice(home.length)}` : path);
  return {
    hosts: {
      claude: { installed: status.claude.installed, path: display(status.claude.path) },
      codex: { installed: status.codex.installed, path: display(status.codex.path) },
      opencode: { installed: status.opencode.installed, path: display(status.opencode.path) },
    },
    codexFeatureEnabled: status.codex.userFeatureEnabled,
    codexFeaturePath: display(status.codex.userFeaturePath),
  };
}

function setupHelp(): string {
  return [
    "Usage:",
    "  sentry-axi setup hooks          install or repair session-start hooks",
    "  sentry-axi setup hooks status   show where hooks are installed",
    "  sentry-axi setup hooks remove   uninstall the hooks",
    "",
    "Hooks run `sentry-axi` at session start in Claude Code, Codex, and OpenCode (user-level).",
    "Install also sets `[features] hooks = true` in ~/.codex/config.toml; remove leaves it because other tools may use it.",
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

export async function makeRuntime(context: MainContext): Promise<Runtime> {
  const url = await resolveMcpUrl(context.env);
  return {
    cwd: context.cwd,
    env: context.env,
    stdout: context.stdout,
    stderr: context.stderr,
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
    signal: context.signal,
  };
}

function executablePath(): string {
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return process.argv[1] ?? "sentry-axi";
  }
}
