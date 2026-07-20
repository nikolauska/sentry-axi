import { resolve } from "node:path";

import { parseFlags, usage } from "../args.ts";
import { CATALOG } from "../catalog.ts";
import type { CatalogSpec } from "../catalog.ts";
import { callSentryTool } from "../lib/mcp-tools.ts";
import { formatToolResult } from "../output.ts";
import { endpointConstraints, readRepoBinding } from "../repo.ts";
import type { InputRecord, ParsedFlags, Runtime } from "../types.ts";

const GLOBAL_FLAGS = new Set(["help", "full", "select", "output", "all-projects"]);

export function catalogCommand(group: string) {
  return async (args: string[], runtime: Runtime) => {
    const [action, ...rest] = args;
    if (!action || action === "--help" || action === "-h") return groupHelp(group);
    const spec = CATALOG[group]?.[action];
    if (!spec)
      throw usage(`unknown ${group} action: ${action}`, [`Run \`sentry-axi ${group} --help\``]);
    if (rest.includes("--help") || rest.includes("-h")) return actionHelp(group, action, spec);

    const booleans = [...spec.booleans.map(cliName), "help", "full", "all-projects"];
    const parsed = parseFlags(rest, { boolean: booleans, array: spec.arrays.map(cliName) });
    const input = await buildInput(spec, parsed, runtime);
    const command = commandText(group, action, rest);
    const result = await callSentryTool(runtime, spec.tool, input);
    return formatToolResult(result, {
      command,
      full: Boolean(parsed.full),
      select: stringValue(parsed.select),
      output: outputPath(parsed.output, runtime.cwd),
      binaryRequired: spec.binary,
    });
  };
}

export function groupHelp(group: string): string {
  const actions = Object.keys(CATALOG[group] ?? {});
  return [
    "Usage:",
    `  sentry-axi ${group} <action> [options]`,
    "",
    `Actions: ${actions.join(", ")}`,
  ].join("\n");
}

function actionHelp(group: string, action: string, spec: CatalogSpec): string {
  const flags = spec.params.map((name) => `--${cliName(name)} <value>`);
  if (spec.binary) flags.push("--output <path>");
  flags.push("--full", "--select <fields>");
  return [
    "Usage:",
    `  sentry-axi ${group} ${action}${spec.positional ? " <value>" : ""} ${flags.join(" ")}`.trimEnd(),
    "",
    `Sentry tool: ${spec.tool}`,
  ].join("\n");
}

async function buildInput(
  spec: CatalogSpec,
  parsed: ParsedFlags,
  runtime: Runtime,
): Promise<InputRecord> {
  const input: InputRecord = {};
  const allowed = new Set(spec.params.map(cliName));
  for (const key of Object.keys(parsed)) {
    if (key === "positionals" || GLOBAL_FLAGS.has(key)) continue;
    if (!allowed.has(key)) throw usage(`unknown flag: --${key}`);
  }

  for (const param of spec.params) {
    const value = parsed[cliName(param)];
    if (value !== undefined) input[param] = parseValue(param, value, spec);
  }
  applyPositional(spec, parsed.positionals, input);
  await applyContextDefaults(spec, parsed, input, runtime);

  if (spec.tool === "execute_sentry_tool" && typeof input.arguments === "string") {
    try {
      input.arguments = JSON.parse(input.arguments);
    } catch {
      throw usage("--arguments must be a JSON object");
    }
    if (!input.arguments || Array.isArray(input.arguments) || typeof input.arguments !== "object") {
      throw usage("--arguments must be a JSON object");
    }
  }

  for (const name of spec.required) {
    if (input[name] === undefined || input[name] === "")
      throw usage(`--${cliName(name)} is required`, [
        "Run the command with --help for its complete flags",
      ]);
  }
  return input;
}

function applyPositional(spec: CatalogSpec, positionals: string[], input: InputRecord): void {
  if (positionals.length === 0) return;
  if (positionals.length > 1) throw usage("too many positional arguments");
  const value = positionals[0];
  if (spec.positionalQuery) {
    if (input[spec.positionalQuery] !== undefined)
      throw usage(`positional query conflicts with --${cliName(spec.positionalQuery)}`);
    input[spec.positionalQuery] = value;
    return;
  }
  if (!spec.positional) throw usage("this command does not accept positional arguments");
  const target =
    typeof spec.positional === "string"
      ? spec.positional
      : /^https?:\/\//.test(value)
        ? spec.positional.url
        : spec.positional.id;
  if (input[target] !== undefined)
    throw usage(`positional value conflicts with --${cliName(target)}`);
  input[target] = value;
}

async function applyContextDefaults(
  spec: CatalogSpec,
  parsed: ParsedFlags,
  input: InputRecord,
  runtime: Runtime,
): Promise<void> {
  const binding = await readRepoBinding(runtime.cwd);
  const constraints = endpointConstraints(runtime.mcpUrl);
  const organizationParam = spec.params.includes("organizationSlug") ? "organizationSlug" : null;
  const projectParam = ["projectSlug", "projectSlugOrId", "project"].find((name) =>
    spec.params.includes(name),
  );

  if (organizationParam) {
    assertConstraint("organization", input[organizationParam], constraints.organization);
    input[organizationParam] ??= constraints.organization ?? binding?.organization;
  }
  if (spec.params.includes("regionUrl")) input.regionUrl ??= binding?.regionUrl;
  if (projectParam) {
    if (parsed["all-projects"]) {
      if (input[projectParam] !== undefined) throw usage("--all-projects conflicts with --project");
      if (spec.required.includes(projectParam))
        throw usage("--all-projects is not valid because this command requires a project");
    } else {
      assertConstraint("project", input[projectParam], constraints.project);
      input[projectParam] ??= constraints.project ?? binding?.project;
    }
  } else if (parsed["all-projects"]) {
    throw usage("--all-projects is not valid for this command");
  }
}

function assertConstraint(name: string, value: unknown, constraint?: string): void {
  if (
    value !== undefined &&
    constraint &&
    String(value).toLowerCase() !== constraint.toLowerCase()
  ) {
    throw usage(`--${name} conflicts with the MCP URL constraint: ${constraint}`);
  }
}

function parseValue(param: string, value: string | string[] | boolean, spec: CatalogSpec): unknown {
  if (spec.numbers.includes(param) || spec.integers.includes(param)) {
    const number = Number(value);
    if (!Number.isFinite(number) || (spec.integers.includes(param) && !Number.isInteger(number))) {
      throw usage(
        `--${cliName(param)} must be ${spec.integers.includes(param) ? "an integer" : "a number"}`,
      );
    }
    return number;
  }
  const choices = spec.enums[param];
  if (choices && (typeof value !== "string" || !choices.includes(value)))
    throw usage(`--${cliName(param)} must be one of: ${choices.join(", ")}`);
  return value;
}

function cliName(param: string): string {
  if (param === "organizationSlug") return "organization";
  if (["projectSlug", "projectSlugOrId", "project"].includes(param)) return "project";
  return param.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function commandText(group: string, action: string, args: string[]): string {
  return ["sentry-axi", group, action, ...args.filter((arg) => arg !== "--full")].join(" ");
}

function outputPath(
  value: string | string[] | boolean | undefined,
  cwd: string,
): string | undefined {
  const path = stringValue(value);
  return path ? resolve(cwd, path) : undefined;
}

function stringValue(value: string | string[] | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
