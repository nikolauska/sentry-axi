import { callSentryTool, extractText } from "../lib/mcp-tools.ts";
import { endpointConstraints, readRepoBinding } from "../repo.ts";
import type { Runtime } from "../types.ts";

export async function homeCommand(runtime: Runtime): Promise<Record<string, unknown>> {
  const binding = await readRepoBinding(runtime.cwd);
  const constraints = endpointConstraints(runtime.mcpUrl);
  const output: Record<string, unknown> = {
    endpoint: runtime.mcpUrl,
    organization: constraints.organization ?? binding?.organization ?? "not initialized",
    project: constraints.project ?? binding?.project ?? "not initialized",
  };
  try {
    output.identity = extractText(await callSentryTool(runtime, "whoami", {})) ?? "authenticated";
  } catch (error) {
    output.status = "Sentry MCP connection unavailable";
    output.error = error instanceof Error ? error.message : String(error);
  }
  output.help =
    binding || constraints.project
      ? ["Run `sentry-axi issues search`", "Run `sentry-axi --help` to list command groups"]
      : [
          "Run `sentry-axi auth login`",
          "Run `sentry-axi init --organization <slug> --project <slug>`",
        ];
  return output;
}
