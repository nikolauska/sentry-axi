import { writeFile } from "node:fs/promises";

import { AxiError } from "axi-sdk-js";

import { extractData, extractText } from "./lib/mcp-tools.ts";
import { usage } from "./args.ts";
import type { McpResult } from "./types.ts";

const PREVIEW_LIMIT = 1500;

interface FormatOptions {
  binaryRequired?: boolean;
  output?: string;
  select?: string;
  full?: boolean;
  command?: string;
}

interface BinaryContent {
  data: string;
  mimeType?: string;
}

export async function formatToolResult(
  result: McpResult,
  options: FormatOptions = {},
): Promise<Record<string, unknown>> {
  if (result?.isError) {
    throw new AxiError(extractText(result) ?? "Sentry MCP operation failed", "OPERATION_ERROR");
  }
  const binary = binaryContent(result);
  if ((options.binaryRequired || binary.length > 0) && !options.output) {
    throw usage("--output is required for binary Sentry content");
  }
  if (binary.length > 1)
    throw usage("the Sentry result contained multiple binary files; use a narrower command");
  if (binary.length === 1)
    await writeFile(options.output as string, Buffer.from(binary[0].data, "base64"));

  let value = extractData(result);
  if (typeof value === "string") value = { result: value };
  if (Array.isArray(value)) value = { count: `${value.length} returned`, items: value };
  if (!isRecord(value)) value = { result: value };
  if (options.select) value = selectFields(value as Record<string, unknown>, options.select);

  const state = { truncated: false };
  value = options.full ? value : truncate(value, state);
  let output: Record<string, unknown> = isRecord(value) ? value : { result: value };
  if (binary.length === 1)
    output = { ...output, output: options.output, mimeType: binary[0].mimeType };
  if (state.truncated) {
    output = {
      ...output,
      help: [...asHelp(output.help), `Run \`${options.command} --full\` for complete content`],
    };
  }
  return output;
}

function binaryContent(result: McpResult): BinaryContent[] {
  return (result?.content ?? []).flatMap((item) => {
    if (item.type === "image" && item.data) return [{ data: item.data, mimeType: item.mimeType }];
    if (item.type === "resource" && item.resource?.blob)
      return [{ data: item.resource.blob, mimeType: item.resource.mimeType }];
    return [];
  });
}

function truncate(value: unknown, state: { truncated: boolean }): unknown {
  if (typeof value === "string") {
    if (value.length <= PREVIEW_LIMIT) return value;
    state.truncated = true;
    return `${value.slice(0, PREVIEW_LIMIT)}... (truncated, ${value.length} chars total)`;
  }
  if (Array.isArray(value)) return value.map((item) => truncate(item, state));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, truncate(item, state)]),
    );
  }
  return value;
}

function selectFields(
  value: Record<string, unknown>,
  fieldsValue: string,
): Record<string, unknown> {
  const fields = String(fieldsValue)
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0) throw usage("--select requires at least one field");
  if (Array.isArray(value.items)) {
    return { ...value, items: value.items.map((item) => pick(item, fields)) };
  }
  return pick(value, fields);
}

function pick(value: unknown, fields: string[]): Record<string, unknown> {
  if (!isRecord(value)) return {};
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
