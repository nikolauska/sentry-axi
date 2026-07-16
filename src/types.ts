import type { Writable } from "node:stream";

export type InputRecord = Record<string, unknown>;
export type Renderable = string | Record<string, unknown>;

export interface McpTool {
  name: string;
}

export interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { blob?: string; mimeType?: string };
}

export interface McpResult {
  structuredContent?: unknown;
  content?: McpContent[];
  isError?: boolean;
}

export interface McpClientLike {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: InputRecord): Promise<McpResult>;
  finishAuth?(code: string): Promise<void>;
  logoutAuth?(): Promise<{ removed: boolean; tokenConfigured: boolean }>;
  close?(): Promise<void>;
}

export interface Runtime {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: Pick<Writable, "write">;
  client: McpClientLike;
  mcpUrl: string;
  binPath?: string;
  toolNames?: Set<string>;
}

export interface MainContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: Pick<Writable, "write">;
  client?: McpClientLike;
}

export interface ParsedFlags {
  positionals: string[];
  [name: string]: string | string[] | boolean | undefined;
}
