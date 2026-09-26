import { AxiError } from "axi-sdk-js";

import { callSentryTool, describeIdentity } from "../lib/mcp-tools.ts";
import { endpointConstraints, readRepoBinding } from "../repo.ts";
import type { Runtime } from "../types.ts";

export async function homeCommand(runtime: Runtime): Promise<Record<string, unknown>> {
  const binding = await readRepoBinding(runtime.cwd);
  const constraints = endpointConstraints(runtime.mcpUrl);
  const organization = constraints.organization ?? binding?.organization;
  const project = constraints.project ?? binding?.project;
  const output: Record<string, unknown> = {
    endpoint: runtime.mcpUrl,
    organization: organization ?? "not initialized",
    project: project ?? "not initialized",
  };
  // Next steps follow the observed state so an authenticated session is never told to log in again.
  const help: string[] = [];
  let connected = false;
  try {
    output.identity = describeIdentity(await callSentryTool(runtime, "whoami", {}));
    connected = true;
  } catch (error) {
    output.status = "Sentry MCP connection unavailable";
    if (error instanceof AxiError) {
      output.error = error.message;
      output.code = error.code;
      help.push(...error.suggestions);
    } else {
      output.error = "Sentry MCP request failed";
    }
  }
  if (!organization || !project) {
    help.push("Run `sentry-axi init --organization <slug> --project <slug>`");
    if (connected) help.push("Run `sentry-axi organizations list` to find the slugs");
  } else if (connected) {
    help.push("Run `sentry-axi issues search`", "Run `sentry-axi --help` to list command groups");
  }
  if (help.length > 0) output.help = help;
  return output;
}
