import { AxiError } from "axi-sdk-js";
import type { InputRecord, McpResult, Runtime } from "../types.ts";

export async function callSentryTool(
  runtime: Runtime,
  name: string,
  args: InputRecord,
): Promise<McpResult> {
  const names = await availableToolNames(runtime);
  if (names.has(name)) return runtime.client.callTool(name, args, runtime.signal);
  if (names.has("execute_sentry_tool")) {
    return runtime.client.callTool(
      "execute_sentry_tool",
      { name, arguments: args },
      runtime.signal,
    );
  }
  if (names.size === 0) return runtime.client.callTool(name, args, runtime.signal);
  throw new AxiError(
    `Sentry MCP tool is unavailable in this session: ${name}`,
    "TOOL_UNAVAILABLE",
    [
      `Run \`sentry-axi tools search ${JSON.stringify(name)}\` to inspect available tools`,
      "Reauthorize if the required Sentry toolset was not granted",
    ],
  );
}

async function availableToolNames(runtime: Runtime): Promise<Set<string>> {
  if (!runtime.toolNames) {
    const tools = await runtime.client.listTools(runtime.signal);
    runtime.toolNames = new Set(tools.map((tool) => tool.name));
  }
  return runtime.toolNames;
}

export function extractData(result: McpResult): unknown {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = extractText(result);
  if (text !== null) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return result ?? {};
}

export function extractText(result: McpResult): string | null {
  const texts = result.content
    ?.filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string);
  return texts?.length ? texts.join("\n") : null;
}
