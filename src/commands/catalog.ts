import { resolve } from "node:path";

import { parseFlags, usage } from "../args.ts";
import { CATALOG } from "../catalog.ts";
import type { CatalogSpec } from "../catalog.ts";
import { callSentryTool } from "../lib/mcp-tools.ts";
import { formatToolResult } from "../output.ts";
import { endpointConstraints, readRepoBinding } from "../repo.ts";
import type { InputRecord, ParsedFlags, Runtime } from "../types.ts";

const GLOBAL_FLAGS = new Set(["help", "full", "select", "output", "all-projects"]);
const PROJECT_PARAMS = ["projectSlug", "projectSlugOrId", "project"];
const BINDING_PARAMS = new Set(["organizationSlug", "regionUrl", ...PROJECT_PARAMS]);

export function catalogCommand(group: string) {
  return async (args: string[], runtime: Runtime) => {
    const [action, ...rest] = args;
    if (!action || action === "--help" || action === "-h") return groupHelp(group);
    const spec = CATALOG[group]?.[action];
    if (!spec)
      throw usage(`unknown ${group} action: ${action}`, [`Run \`sentry-axi ${group} --help\``]);
    if (rest.includes("--help") || rest.includes("-h")) return actionHelp(group, action, spec);

    const hint = [`Run \`sentry-axi ${group} ${action} --help\``];
    const booleans = [...spec.booleans.map(cliName), "help", "full", "all-projects"];
    const parsed = parseFlags(rest, {
      boolean: booleans,
      array: spec.arrays.map(cliName),
      suggestions: hint,
    });
    const input = await buildInput(spec, parsed, runtime, hint);
    const result = await callSentryTool(runtime, spec.tool, input);
    const limit = effectiveLimit(spec, input, runtime);
    return formatToolResult(result, {
      command: commandText(group, action, rest),
      unselectedCommand: commandText(group, action, withoutFlag(rest, "select")),
      full: Boolean(parsed.full),
      select: stringValue(parsed.select),
      output: outputPath(parsed.output, runtime.cwd),
      binaryRequired: spec.binary,
      // Sentry names every list tool find_* or search_*; only those get compact rows.
      list: /^(find|search)_/.test(spec.tool),
      limit,
      moreCommand: spec.params.includes("limit")
        ? `${commandText(group, action, withoutFlag(rest, "limit"))} --limit ${limit === undefined ? "<n>" : limit * 2}`
        : undefined,
      nextPageCommand: spec.params.includes("cursor")
        ? (cursor: string) =>
            `${commandText(group, action, withoutFlag(rest, "cursor"))} --cursor ${shellQuote(cursor)}`
        : undefined,
    });
  };
}

function groupHelp(group: string): string {
  const actions = Object.keys(CATALOG[group] ?? {});
  return [
    "Usage:",
    `  sentry-axi ${group} <action> [flags]`,
    "",
    `Actions: ${actions.join(", ")}`,
    "",
    `Run \`sentry-axi ${group} <action> --help\` for the flags of one action.`,
  ].join("\n");
}

function actionHelp(group: string, action: string, spec: CatalogSpec): string {
  const projectParam = PROJECT_PARAMS.find((name) => spec.params.includes(name));
  const rows: Array<[string, string]> = spec.params.map((param) => {
    const notes = [];
    if (spec.required.includes(param)) notes.push("required");
    if (BINDING_PARAMS.has(param)) notes.push("defaults to .sentry-project");
    if (spec.arrays.includes(param)) notes.push("repeatable");
    return [`--${cliName(param)}${valueHint(param, spec)}`, notes.join("; ")];
  });
  if (projectParam && !spec.required.includes(projectParam))
    rows.push(["--all-projects", "search every project instead of the repository default"]);
  if (spec.binary)
    rows.push(["--output <path>", "required; file that receives the binary content"]);
  rows.push(
    ["--select <fields>", "comma-separated fields to keep from structured results"],
    ["--full", "show complete values and every field"],
  );
  const width = Math.max(...rows.map(([flag]) => flag.length));
  return [
    "Usage:",
    `  sentry-axi ${group} ${action}${positionalHint(spec)} [flags]`,
    "",
    "Flags:",
    ...rows.map(([flag, note]) => `  ${flag.padEnd(width)}  ${note}`.trimEnd()),
    "",
    `Sentry tool: ${spec.tool}`,
  ].join("\n");
}

function positionalHint(spec: CatalogSpec): string {
  if (spec.positionalQuery) return ` [<${cliName(spec.positionalQuery)}>]`;
  if (!spec.positional) return "";
  if (typeof spec.positional === "string") return ` [<${cliName(spec.positional)}>]`;
  return ` [<${cliName(spec.positional.id)}|${cliName(spec.positional.url)}>]`;
}

function valueHint(param: string, spec: CatalogSpec): string {
  if (spec.booleans.includes(param)) return "";
  if (spec.enums[param]) return ` <${spec.enums[param].join("|")}>`;
  if (spec.integers.includes(param)) return " <integer>";
  if (spec.numbers.includes(param)) return " <number>";
  return " <value>";
}

async function buildInput(
  spec: CatalogSpec,
  parsed: ParsedFlags,
  runtime: Runtime,
  hint: string[],
): Promise<InputRecord> {
  const input: InputRecord = {};
  const allowed = new Set(spec.params.map(cliName));
  for (const key of Object.keys(parsed)) {
    if (key === "positionals" || GLOBAL_FLAGS.has(key)) continue;
    if (!allowed.has(key)) throw usage(`unknown flag: --${key}`, hint);
  }

  for (const param of spec.params) {
    const value = parsed[cliName(param)];
    if (value !== undefined) input[param] = parseValue(param, value, spec, hint);
  }
  applyPositional(spec, parsed.positionals, input, hint);
  await applyContextDefaults(spec, parsed, input, runtime, hint);

  if (spec.tool === "execute_sentry_tool" && typeof input.arguments === "string") {
    try {
      input.arguments = JSON.parse(input.arguments);
    } catch {
      throw usage("--arguments must be a JSON object", hint);
    }
    if (!input.arguments || Array.isArray(input.arguments) || typeof input.arguments !== "object") {
      throw usage("--arguments must be a JSON object", hint);
    }
  }

  for (const name of spec.required) {
    if (input[name] === undefined || input[name] === "")
      throw usage(`--${cliName(name)} is required`, requiredHint(name, input, hint));
  }
  return input;
}

// Organization and project are usually missing because the repository is not bound yet,
// so point at the commands that discover and save them rather than at generic help.
function requiredHint(param: string, input: InputRecord, hint: string[]): string[] {
  const init = "Run `sentry-axi init --organization <slug> --project <slug>` to save defaults";
  if (param === "organizationSlug") return [init, "Run `sentry-axi organizations list`"];
  if (PROJECT_PARAMS.includes(param)) {
    const organization =
      typeof input.organizationSlug === "string" ? input.organizationSlug : "<slug>";
    return [init, `Run \`sentry-axi projects list --organization ${organization}\``];
  }
  return hint;
}

function applyPositional(
  spec: CatalogSpec,
  positionals: string[],
  input: InputRecord,
  hint: string[],
): void {
  if (positionals.length === 0) return;
  if (positionals.length > 1) throw usage("too many positional arguments", hint);
  const value = positionals[0];
  if (spec.positionalQuery) {
    if (input[spec.positionalQuery] !== undefined)
      throw usage(`positional query conflicts with --${cliName(spec.positionalQuery)}`, hint);
    input[spec.positionalQuery] = value;
    return;
  }
  if (!spec.positional) throw usage("this command does not accept positional arguments", hint);
  const target =
    typeof spec.positional === "string"
      ? spec.positional
      : /^https?:\/\//.test(value)
        ? spec.positional.url
        : spec.positional.id;
  if (input[target] !== undefined)
    throw usage(`positional value conflicts with --${cliName(target)}`, hint);
  input[target] = value;
}

async function applyContextDefaults(
  spec: CatalogSpec,
  parsed: ParsedFlags,
  input: InputRecord,
  runtime: Runtime,
  hint: string[],
): Promise<void> {
  const binding = await readRepoBinding(runtime.cwd);
  const constraints = endpointConstraints(runtime.mcpUrl);
  const organizationParam = spec.params.includes("organizationSlug") ? "organizationSlug" : null;
  const projectParam = PROJECT_PARAMS.find((name) => spec.params.includes(name));

  if (organizationParam) {
    assertConstraint("organization", input[organizationParam], constraints.organization, hint);
    input[organizationParam] ??= constraints.organization ?? binding?.organization;
  }
  if (spec.params.includes("regionUrl")) input.regionUrl ??= binding?.regionUrl;
  if (projectParam) {
    if (parsed["all-projects"]) {
      if (input[projectParam] !== undefined)
        throw usage("--all-projects conflicts with --project", hint);
      if (spec.required.includes(projectParam))
        throw usage("--all-projects is not valid because this command requires a project", hint);
    } else {
      assertConstraint("project", input[projectParam], constraints.project, hint);
      input[projectParam] ??= constraints.project ?? binding?.project;
    }
  } else if (parsed["all-projects"]) {
    throw usage("--all-projects is not valid for this command", hint);
  }
}

function assertConstraint(
  name: string,
  value: unknown,
  constraint: string | undefined,
  hint: string[],
): void {
  if (
    value !== undefined &&
    constraint &&
    String(value).toLowerCase() !== constraint.toLowerCase()
  ) {
    throw usage(`--${name} conflicts with the MCP URL constraint: ${constraint}`, hint);
  }
}

function parseValue(
  param: string,
  value: string | string[] | boolean,
  spec: CatalogSpec,
  hint: string[],
): unknown {
  if (spec.numbers.includes(param) || spec.integers.includes(param)) {
    const number = Number(value);
    if (!Number.isFinite(number) || (spec.integers.includes(param) && !Number.isInteger(number))) {
      throw usage(
        `--${cliName(param)} must be ${spec.integers.includes(param) ? "an integer" : "a number"}`,
        hint,
      );
    }
    return number;
  }
  const choices = spec.enums[param];
  if (choices && (typeof value !== "string" || !choices.includes(value)))
    throw usage(`--${cliName(param)} must be one of: ${choices.join(", ")}`, hint);
  return value;
}

// Only an explicit or schema-declared limit tells us a full page may hide more results.
function effectiveLimit(spec: CatalogSpec, input: InputRecord, runtime: Runtime) {
  if (!spec.params.includes("limit")) return undefined;
  if (typeof input.limit === "number") return input.limit;
  const fallback = runtime.tools?.get(spec.tool)?.inputSchema?.properties?.limit?.default;
  return typeof fallback === "number" ? fallback : undefined;
}

function cliName(param: string): string {
  if (param === "organizationSlug") return "organization";
  if (PROJECT_PARAMS.includes(param)) return "project";
  return param.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

// Suggested follow-ups replace a flag's value, so drop the original in both `--x v` and `--x=v` forms.
function withoutFlag(args: string[], name: string): string[] {
  const flag = `--${name}`;
  const kept: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === flag) index++;
    else if (!args[index].startsWith(`${flag}=`)) kept.push(args[index]);
  }
  return kept;
}

// Suggested commands must survive copy-paste into a shell, so quote anything with spaces or metacharacters.
function commandText(group: string, action: string, args: string[]): string {
  return [
    "sentry-axi",
    group,
    action,
    ...args.filter((arg) => arg !== "--full").map(shellQuote),
  ].join(" ");
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
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
