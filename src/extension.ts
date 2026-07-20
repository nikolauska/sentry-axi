import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateLine,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { encode } from "@toon-format/toon";
import { AxiError } from "axi-sdk-js";
import { Type } from "typebox";

import type { MainContext, Renderable, Runtime } from "./types.ts";

const ACTIONS = [
  "dashboard",
  "auth",
  "init",
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
] as const;

const parameters = Type.Object({
  action: StringEnum(ACTIONS, {
    description: "Sentry command group to run; dashboard runs sentry-axi with no arguments",
  }),
  args: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Arguments after the command group, such as ['search', 'unresolved errors', '--limit', '10']",
    }),
  ),
});

type RuntimeFactory = (context: MainContext) => Promise<Runtime>;
type Dispatcher = (args: string[], runtime: Runtime) => Promise<Renderable>;

function commandArgs(action: (typeof ACTIONS)[number], args: string[]): string[] {
  if (action === "dashboard") return [];
  if (action === "auth" && args[0] === "login" && !args.includes("--manual")) {
    return [action, ...args, "--manual"];
  }
  return [action, ...args];
}

function formatError(error: unknown): string {
  if (error instanceof AxiError) {
    return encode({
      error: error.message,
      code: error.code,
      ...(error.suggestions.length > 0 ? { help: error.suggestions } : {}),
    });
  }
  return encode({
    error: error instanceof Error ? error.message : String(error),
    code: "UNKNOWN",
  });
}

export function registerSentryExtension(
  pi: ExtensionAPI,
  // OMP's install-time validator rejects the MCP client's transitive CJS graph; load it on use.
  runtimeFactory: RuntimeFactory = async (context) =>
    (await import("./cli.ts")).makeRuntime(context),
  dispatch: Dispatcher = async (args, runtime) => (await import("./cli.ts")).run(args, runtime),
): void {
  pi.registerTool({
    name: "sentry_axi",
    label: "Sentry",
    description:
      "Investigate and operate Sentry issues, events, traces, replays, releases, projects, alerts, dashboards, monitors, profiles, snapshots, attachments, and docs. Returns compact TOON output.",
    promptSnippet: "Investigate and operate Sentry through the agent-oriented sentry-axi interface",
    promptGuidelines: [
      "Use sentry_axi for Sentry operations instead of raw Sentry MCP calls when the tool is available.",
    ],
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Sentry operation cancelled");

      const runtime = await runtimeFactory({
        cwd: ctx.cwd,
        env: process.env,
        stdout: { write: () => true },
        signal,
      });

      let value: Renderable | undefined;
      let operationError: Error | undefined;
      try {
        value = await dispatch(commandArgs(params.action, params.args ?? []), runtime);
      } catch (error) {
        operationError = new Error(formatError(error));
      }
      try {
        await runtime.client.close?.();
      } catch (error) {
        operationError ??= new Error(formatError(error));
      }
      if (operationError) throw operationError;
      if (value === undefined) throw new Error("Sentry operation returned no output");

      const text = typeof value === "string" ? value : encode(value);
      const truncation = truncateHead(text, {
        maxBytes: DEFAULT_MAX_BYTES,
        maxLines: DEFAULT_MAX_LINES,
      });

      if (!truncation.truncated) {
        return {
          content: [{ type: "text", text }],
          details: { action: params.action },
        };
      }

      const directory = await mkdtemp(join(tmpdir(), "sentry-axi-"));
      const outputPath = join(directory, `${params.action}.toon`);
      await writeFile(outputPath, text, "utf8");
      const preview = truncation.firstLineExceedsLimit
        ? truncateLine(text.split("\n", 1)[0], 4000).text
        : truncation.content;
      const previewLines = preview ? preview.split("\n").length : 0;
      const previewBytes = Buffer.byteLength(preview);
      const notice =
        `\n\n[Output truncated: ${previewLines} of ${truncation.totalLines} lines ` +
        `(${formatSize(previewBytes)} of ${formatSize(truncation.totalBytes)}). ` +
        `Full output saved to: ${outputPath}]`;

      return {
        content: [{ type: "text", text: preview + notice }],
        details: { action: params.action },
      };
    },
  });
}

export default function sentryExtension(pi: ExtensionAPI): void {
  registerSentryExtension(pi);
}
