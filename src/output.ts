import { writeFile } from "node:fs/promises";

import { AxiError } from "axi-sdk-js";

import { extractData, extractText } from "./lib/mcp-tools.ts";
import { usage } from "./args.ts";
import { CATALOG } from "./catalog.ts";
import type { McpResult, Renderable } from "./types.ts";

// Detail views should show a whole issue with its stack trace; 1500 cut real issues mid-trace.
const PREVIEW_LIMIT = 6000;
// List rows are for choosing what to open next, so they get a much shorter preview than detail views.
const LIST_PREVIEW_LIMIT = 200;

// Sentry's markdown names MCP tools; agents using this CLI need the command that reaches each one.
const TOOL_COMMANDS = new Map<string, string[]>([["whoami", ["sentry-axi auth whoami"]]]);
for (const [group, actions] of Object.entries(CATALOG)) {
  for (const [action, spec] of Object.entries(actions)) {
    TOOL_COMMANDS.set(spec.tool, [
      ...(TOOL_COMMANDS.get(spec.tool) ?? []),
      `sentry-axi ${group} ${action}`,
    ]);
  }
}

interface FormatOptions {
  binaryRequired?: boolean;
  output?: string;
  select?: string;
  full?: boolean;
  command?: string;
  // The same command without `--select`, for hints that must drop the rejected selection.
  unselectedCommand?: string;
  list?: boolean;
  limit?: number;
  moreCommand?: string;
  nextPageCommand?: (cursor: string) => string;
}

interface BinaryContent {
  data: string;
  mimeType?: string;
}

interface TruncationState {
  truncated: boolean;
}

export async function formatToolResult(
  result: McpResult,
  options: FormatOptions = {},
): Promise<Renderable> {
  if (result?.isError) {
    const text = extractText(result);
    throw new AxiError(
      text
        ? translateToolReferences(truncate(text, PREVIEW_LIMIT, { truncated: false }) as string)
        : "Sentry MCP operation failed",
      "OPERATION_ERROR",
    );
  }
  const binary = binaryContent(result);
  if ((options.binaryRequired || binary.length > 0) && !options.output) {
    throw usage("--output is required for binary Sentry content");
  }
  if (binary.length > 1)
    throw usage("the Sentry result contained multiple binary files; use a narrower command");
  if (binary.length === 1)
    await writeFile(options.output as string, Buffer.from(binary[0].data, "base64"));

  const data = extractData(result);
  // Sentry answers most detail tools in markdown; printing it verbatim avoids escaping every
  // newline and quote into a single TOON string.
  if (typeof data === "string" && binary.length === 0) {
    if (options.select)
      throw usage("--select needs structured records, but Sentry returned text", [
        `Run \`${options.unselectedCommand ?? options.command} --full\` to read the complete text`,
      ]);
    return markdownResult(data, options);
  }
  let output: Record<string, unknown> = Array.isArray(data)
    ? { count: `${data.length} returned`, items: data }
    : isRecord(data)
      ? { ...data }
      : { result: data };
  // Sentry list tools return `{ <resources>: [...], hasMore }`, so any array of records is a row set.
  const listKeys = Object.keys(output).filter(
    (key) => Array.isArray(output[key]) && (output[key] as unknown[]).every(isRecord),
  );
  const help = paginationHelp(output, listKeys, options);
  if (Array.isArray(data) && options.limit !== undefined && data.length >= options.limit)
    output.count = `${data.length} returned; limit ${options.limit} reached, more may exist`;

  if (options.select) {
    const fields = selectedFields(
      options.select,
      data,
      output,
      listKeys,
      options.unselectedCommand ?? options.command,
    );
    output =
      listKeys.length > 0
        ? {
            ...output,
            ...Object.fromEntries(
              listKeys.map((key) => [
                key,
                (output[key] as Record<string, unknown>[]).map((row) => pick(row, fields)),
              ]),
            ),
          }
        : pick(output, fields);
  }

  const state: TruncationState = { truncated: false };
  if (options.list && !options.select && !options.full) {
    const hidden = new Set<string>();
    for (const key of listKeys) {
      output[key] = (output[key] as Record<string, unknown>[]).map((row) =>
        compactRow(row, hidden, state),
      );
    }
    if (hidden.size > 0) {
      help.push(
        `List rows hide nested fields: ${[...hidden].join(", ")}. Run \`${options.command} --select <fields>\` or \`${options.command} --full\` to include them`,
      );
    }
  }
  if (!options.full) output = truncate(output, PREVIEW_LIMIT, state) as Record<string, unknown>;
  if (state.truncated) help.push(`Run \`${options.command} --full\` for complete content`);

  if (Object.keys(output).length === 0) output = { result: "Sentry returned no content" };
  if (binary.length === 1)
    output = { ...output, output: options.output, mimeType: binary[0].mimeType };
  const allHelp = [...asHelp(output.help), ...help];
  return allHelp.length > 0 ? { ...output, help: allHelp } : output;
}

function markdownResult(markdown: string, options: FormatOptions): string {
  let body = translateToolReferences(markdown).trimEnd();
  const help: string[] = [];
  if (!options.full && body.length > PREVIEW_LIMIT) {
    // Cutting at a line boundary keeps tables and stack frames intact.
    const lineEnd = body.lastIndexOf("\n", PREVIEW_LIMIT);
    let cut = body.slice(0, lineEnd > PREVIEW_LIMIT / 2 ? lineEnd : PREVIEW_LIMIT);
    // An odd number of fences means the cut landed inside a code block; close it so the
    // truncation note is not read as code.
    if ((cut.match(/^```/gm) ?? []).length % 2 === 1) cut += "\n```";
    body = `${cut}\n\n… (truncated, showing ${cut.length} of ${body.length} characters)`;
    help.push(`Run \`${options.command} --full\` for complete content`);
  }
  if (help.length === 0) return body;
  // Sentry's own markdown already uses "Next Steps"; a distinct heading keeps the two apart.
  return `${body}\n\n## More content\n\n${help.map((line) => `- ${line}`).join("\n")}`;
}

// Sentry mentions tools as "the Sentry tool `name`", as `name`, or as a bare snake_case word.
// Only exact catalog tool names are rewritten (plus anything explicitly called a Sentry tool),
// and bare names inside URLs or paths are skipped, so search syntax and links stay untouched.
function translateToolReferences(text: string): string {
  return text.replace(
    /(?:the )?Sentry tool `([a-z][a-z0-9_]*)`|`([a-z][a-z0-9_]*)`|(?<![\w/.=:%-])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![\w/-])/g,
    (match, named?: string, quoted?: string, bare?: string) => {
      const tool = (named ?? quoted ?? bare) as string;
      const commands = TOOL_COMMANDS.get(tool);
      if (commands) return commands.map((command) => `\`${command}\``).join(" or ");
      if (named === undefined) return match;
      return `\`sentry-axi tools run ${tool} --arguments '<json>'\``;
    },
  );
}

// A full page looks identical to a complete answer, so say explicitly when more rows exist.
function paginationHelp(
  output: Record<string, unknown>,
  listKeys: string[],
  options: FormatOptions,
): string[] {
  if (typeof output.nextCursor === "string" && output.nextCursor && options.nextPageCommand)
    return [`Run \`${options.nextPageCommand(output.nextCursor)}\` for the next page`];
  const limitReached =
    options.limit !== undefined &&
    listKeys.some((key) => (output[key] as unknown[]).length >= (options.limit as number));
  if (output.hasMore !== true && !limitReached) return [];
  return [
    options.moreCommand
      ? `More results exist. Run \`${options.moreCommand}\` or narrow the query to see them`
      : "More results exist. Narrow the query or filters to see them",
  ];
}

function binaryContent(result: McpResult): BinaryContent[] {
  return (result?.content ?? []).flatMap((item) => {
    if (item.type === "image" && item.data) return [{ data: item.data, mimeType: item.mimeType }];
    if (item.type === "resource" && item.resource?.blob)
      return [{ data: item.resource.blob, mimeType: item.resource.mimeType }];
    return [];
  });
}

// Scalars are what an agent compares across rows; nested objects are detail-view material.
function compactRow(
  row: Record<string, unknown>,
  hidden: Set<string>,
  state: TruncationState,
): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && typeof value === "object") hidden.add(key);
    else compact[key] = truncate(value, LIST_PREVIEW_LIMIT, state);
  }
  return compact;
}

function truncate(value: unknown, limit: number, state: TruncationState): unknown {
  if (typeof value === "string") {
    if (value.length <= limit) return value;
    state.truncated = true;
    return `${value.slice(0, limit)}... (truncated, ${value.length} chars total)`;
  }
  if (Array.isArray(value)) return value.map((item) => truncate(item, limit, state));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, truncate(item, limit, state)]),
    );
  }
  return value;
}

// Rejecting unusable selections keeps `--select` from turning a real result into empty output.
function selectedFields(
  fieldsValue: string,
  data: unknown,
  output: Record<string, unknown>,
  listKeys: string[],
  command: string | undefined,
): string[] {
  const fields = String(fieldsValue)
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (!isRecord(data) && listKeys.length === 0) {
    throw usage("--select needs structured records, but Sentry returned text", [
      `Run \`${command} --full\` to read the complete text`,
    ]);
  }
  const rows =
    listKeys.length > 0
      ? listKeys.flatMap((key) => output[key] as Record<string, unknown>[])
      : [output];
  if (rows.length === 0) return fields;
  const available = new Set(rows.flatMap((row) => Object.keys(row)));
  const missing = fields.filter((field) => !available.has(field));
  if (missing.length > 0) {
    throw usage(`--select field not found: ${missing.join(", ")}`, [
      `Available fields: ${[...available].join(", ")}`,
    ]);
  }
  return fields;
}

function pick(value: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter((field) => field in value).map((field) => [field, value[field]]),
  );
}

function asHelp(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
