export const DEFAULT_MCP_URL = "https://mcp.sentry.dev/mcp";

export function resolveMcpUrl(env: NodeJS.ProcessEnv): string {
  return env.SENTRY_AXI_MCP_URL ?? DEFAULT_MCP_URL;
}
