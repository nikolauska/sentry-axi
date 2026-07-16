import { callSentryTool, extractText } from "../lib/mcp-tools.js";
import { endpointConstraints, readRepoBinding } from "../repo.js";

export async function homeCommand(runtime) {
  const binding = await readRepoBinding(runtime.cwd);
  const constraints = endpointConstraints(runtime.mcpUrl);
  const output = {
    endpoint: runtime.mcpUrl,
    organization: constraints.organization ?? binding?.organization ?? "not initialized",
    project: constraints.project ?? binding?.project ?? "not initialized",
  };
  try {
    output.identity = extractText(await callSentryTool(runtime, "whoami", {})) ?? "authenticated";
  } catch (error) {
    output.status = "Sentry MCP connection unavailable";
    output.error = error?.message ?? String(error);
  }
  output.help = binding || constraints.project ? [
    "Run `sentry-axi issues search`",
    "Run `sentry-axi --help` to list command groups",
  ] : [
    "Run `sentry-axi auth login`",
    "Run `sentry-axi init --organization <slug> --project <slug>`",
  ];
  return output;
}
