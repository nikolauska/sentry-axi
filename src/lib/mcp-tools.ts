import { AxiError } from "axi-sdk-js";
import type { InputRecord, McpResult, McpTool, Runtime } from "../types.ts";

export async function callSentryTool(
  runtime: Runtime,
  name: string,
  args: InputRecord,
): Promise<McpResult> {
  const tools = await availableTools(runtime);
  if (tools.has(name)) return runtime.client.callTool(name, args, runtime.signal);
  if (tools.has("execute_sentry_tool")) {
    return runtime.client.callTool(
      "execute_sentry_tool",
      { name, arguments: args },
      runtime.signal,
    );
  }
  if (tools.size === 0) return runtime.client.callTool(name, args, runtime.signal);
  throw new AxiError(
    `Sentry MCP tool is unavailable in this session: ${name}`,
    "TOOL_UNAVAILABLE",
    [
      `Run \`sentry-axi tools search ${JSON.stringify(name)}\` to inspect available tools`,
      "Reauthorize if the required Sentry toolset was not granted",
    ],
  );
}

// Schemas are kept so output shaping can read declared defaults such as the page limit.
async function availableTools(runtime: Runtime): Promise<Map<string, McpTool>> {
  if (!runtime.tools) {
    const tools = await runtime.client.listTools(runtime.signal);
    runtime.tools = new Map(tools.map((tool) => [tool.name, tool]));
  }
  return runtime.tools;
}

// Current servers answer whoami with `{ user: { name, email } }` JSON; older ones with prose.
export function describeIdentity(result: McpResult): string {
  const user = (extractData(result) as { user?: { name?: unknown; email?: unknown } } | null)?.user;
  if (typeof user?.name === "string")
    return typeof user.email === "string" ? `${user.name} <${user.email}>` : user.name;
  return extractText(result) ?? "authenticated";
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
