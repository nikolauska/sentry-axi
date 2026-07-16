import { AxiError } from "axi-sdk-js";

export async function callSentryTool(runtime, name, args) {
  const names = await availableToolNames(runtime);
  if (names.has(name)) return runtime.client.callTool(name, args);
  if (names.has("execute_sentry_tool")) {
    return runtime.client.callTool("execute_sentry_tool", { name, arguments: args });
  }
  if (names.size === 0) return runtime.client.callTool(name, args);
  throw new AxiError(`Sentry MCP tool is unavailable in this session: ${name}`, "TOOL_UNAVAILABLE", [
    `Run \`sentry-axi tools search ${JSON.stringify(name)}\` to inspect available tools`,
    "Reauthorize if the required Sentry toolset was not granted",
  ]);
}

export async function availableToolNames(runtime) {
  if (!runtime.toolNames) {
    const tools = await runtime.client.listTools();
    runtime.toolNames = new Set(tools.map((tool) => tool.name));
  }
  return runtime.toolNames;
}

export function extractData(result) {
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

export function extractText(result) {
  const texts = result?.content?.filter?.((item) => item.type === "text").map((item) => item.text);
  return texts?.length ? texts.join("\n") : null;
}
