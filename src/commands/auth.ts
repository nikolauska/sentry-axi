import { createServer } from "node:http";

import { AxiError } from "axi-sdk-js";

import { parseFlags, usage } from "../args.ts";
import { callSentryTool, describeIdentity } from "../lib/mcp-tools.ts";
import type { Renderable, Runtime } from "../types.ts";

const AUTH_HINT = ["Run `sentry-axi auth --help`"];

export async function authCommand(args: string[], runtime: Runtime): Promise<Renderable> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") return authHelp();
  if (action === "login") return loginCommand(rest, runtime);
  if (action === "finish") return finishCommand(rest, runtime);
  if (action === "logout") return logoutCommand(rest, runtime);
  if (action === "whoami") return whoamiCommand(rest, runtime);
  throw usage(`unknown auth action: ${action}`, AUTH_HINT);
}

export function authHelp() {
  return [
    "Usage:",
    "  sentry-axi auth login [--manual] [--timeout <ms>]",
    "  sentry-axi auth finish --code <code>",
    "  sentry-axi auth logout",
    "  sentry-axi auth whoami",
    "",
    "`auth login` waits up to --timeout ms (default 300000) for the browser callback.",
    "Use `auth login --manual`, then `auth finish --code <code>`, when the shell cannot wait.",
  ].join("\n");
}

async function whoamiCommand(args: string[], runtime: Runtime): Promise<Renderable> {
  const parsed = parseFlags(args, { boolean: ["help"], suggestions: AUTH_HINT });
  if (parsed.help) return authHelp();
  if (parsed.positionals.length > 0)
    throw usage("auth whoami does not accept positional arguments", AUTH_HINT);
  return { identity: describeIdentity(await callSentryTool(runtime, "whoami", {})) };
}

async function loginCommand(args: string[], runtime: Runtime): Promise<Renderable> {
  const parsed = parseFlags(args, { boolean: ["help", "manual"], suggestions: AUTH_HINT });
  if (parsed.help) return authHelp();
  try {
    await runtime.client.listTools();
    return { auth: "Sentry MCP already authorized" };
  } catch (error) {
    const authorizationUrl = authUrl(error);
    if (!authorizationUrl) throw error;
    if (parsed.manual) {
      return {
        auth: "Sentry MCP OAuth authorization required",
        url: authorizationUrl,
        help: ["Open the URL, copy the code, then run `sentry-axi auth finish --code <code>`"],
      };
    }
    return completeLoginWithCallback(authorizationUrl, runtime, stringValue(parsed.timeout));
  }
}

async function finishCommand(args: string[], runtime: Runtime): Promise<Renderable> {
  const parsed = parseFlags(args, { boolean: ["help"], suggestions: AUTH_HINT });
  if (parsed.help) return authHelp();
  if (!parsed.code)
    throw usage("--code is required", ["Run `sentry-axi auth finish --code <code>`"]);
  if (!runtime.client.finishAuth) throw usage("the configured MCP client cannot finish OAuth");
  await runtime.client.finishAuth(String(parsed.code));
  return { auth: "Sentry MCP OAuth authorized" };
}

async function logoutCommand(args: string[], runtime: Runtime): Promise<Renderable> {
  const parsed = parseFlags(args, { boolean: ["help"], suggestions: AUTH_HINT });
  if (parsed.help) return authHelp();
  if (!runtime.client.logoutAuth) throw usage("the configured MCP client cannot clear OAuth");
  const result = await runtime.client.logoutAuth();
  return {
    auth: result.removed
      ? "Sentry MCP OAuth credentials cleared"
      : "Sentry MCP OAuth credentials already absent",
    ...(result.tokenConfigured ? { note: "A token environment variable remains configured" } : {}),
  };
}

async function completeLoginWithCallback(
  authorizationUrl: string,
  runtime: Runtime,
  timeoutValue?: string,
): Promise<Renderable> {
  const timeoutMs = parseTimeout(timeoutValue ?? "300000");
  const callbackUrl = new URL("http://127.0.0.1:14567/oauth/callback");
  const expectedState = new URL(authorizationUrl).searchParams.get("state");
  if (!expectedState)
    throw usage("OAuth authorization URL did not include state", [
      "Run `sentry-axi auth login --manual`",
    ]);
  const server = await startOAuthCallbackServer(callbackUrl, timeoutMs, expectedState);

  // The URL must be visible while this command blocks, but stdout is reserved for the single
  // structured result, so the interim notice goes to stderr.
  (runtime.stderr ?? process.stderr).write(
    [
      "auth: Sentry MCP OAuth authorization required",
      `url: ${JSON.stringify(authorizationUrl)}`,
      `callback: ${JSON.stringify(callbackUrl.toString())}`,
      "help[2]:",
      "  Open the URL in a browser",
      "  Use `sentry-axi auth login --manual` if callback capture fails",
      "",
    ].join("\n"),
  );

  try {
    if (!runtime.client.finishAuth) throw usage("the configured MCP client cannot finish OAuth");
    await runtime.client.finishAuth(await server.code);
    return { auth: "Sentry MCP OAuth authorized" };
  } finally {
    await server.close();
  }
}

function parseTimeout(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw usage("--timeout must be a positive number");
  return number;
}

async function startOAuthCallbackServer(
  callbackUrl: URL,
  timeoutMs: number,
  expectedState: string,
) {
  let timeout: NodeJS.Timeout | undefined;
  let settled = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", callbackUrl.origin);
    if (url.pathname !== callbackUrl.pathname) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found.\n");
      return;
    }
    const error = url.searchParams.get("error");
    const authCode = url.searchParams.get("code");
    if (url.searchParams.get("state") !== expectedState) {
      // Keep waiting: a stale tab from an older login must not end the current one.
      response.writeHead(400, { "content-type": "text/plain" });
      response.end(
        "This sign-in page belongs to an older sentry-axi login. Open the newest URL printed by sentry-axi.\n",
      );
      return;
    }
    if (error || !authCode) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Sentry authorization failed. You can close this tab.\n");
      finish(
        new AxiError(
          error ? `Sentry OAuth error: ${error}` : "OAuth callback did not include a code",
          "AUTH_ERROR",
          ["Run `sentry-axi auth login` to start a new authorization"],
        ),
        undefined,
      );
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("Sentry authorization captured. You can close this tab.\n");
    finish(null, authCode);
  });

  function finish(error: Error | null, authCode?: string): void {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    if (error) rejectCode(error);
    else resolveCode(authCode as string);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(
        new AxiError(
          `Could not listen for the OAuth callback on ${callbackUrl.host}${error.code ? ` (${error.code})` : ""}`,
          "AUTH_ERROR",
          ["Run `sentry-axi auth login --manual`"],
        ),
      ),
    );
    server.listen(Number(callbackUrl.port), callbackUrl.hostname, () => resolve());
  });
  timeout = setTimeout(
    () =>
      finish(
        new AxiError("Timed out waiting for Sentry OAuth callback", "AUTH_TIMEOUT", [
          "Run `sentry-axi auth login` again, or `sentry-axi auth login --manual` if the browser cannot reach the callback",
        ]),
        undefined,
      ),
    timeoutMs,
  );
  return { code, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function authUrl(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("authorizationUrl" in error)) return null;
  return typeof error.authorizationUrl === "string" ? error.authorizationUrl : null;
}

function stringValue(value: string | string[] | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
