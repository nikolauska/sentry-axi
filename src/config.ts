import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_MCP_URL = "https://mcp.sentry.dev/mcp";

export async function resolveMcpUrl(env: NodeJS.ProcessEnv): Promise<string> {
  if (env.SENTRY_AXI_MCP_URL) return env.SENTRY_AXI_MCP_URL;

  const configPath = env.CODEX_CONFIG ?? join(homedir(), ".codex", "config.toml");
  try {
    return extractSentryMcpUrl(await readFile(configPath, "utf8")) ?? DEFAULT_MCP_URL;
  } catch {
    return DEFAULT_MCP_URL;
  }
}

export function extractSentryMcpUrl(text: string): string | null {
  let inSentryTable = false;
  for (const line of text.split(/\r?\n/)) {
    const table = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (table) {
      inSentryTable = table[1].trim() === "mcp_servers.sentry";
      continue;
    }
    if (!inSentryTable) continue;
    const url = line.match(/^\s*url\s*=\s*(['"])(.*?)\1\s*(?:#.*)?$/);
    if (url) return url[2];
  }
  return null;
}
