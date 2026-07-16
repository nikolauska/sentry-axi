import { createServer } from "node:http";

import { parseFlags, usage } from "../args.js";

export async function authCommand(args, runtime) {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") return authHelp();
  if (action === "login") return loginCommand(rest, runtime);
  if (action === "finish") return finishCommand(rest, runtime);
  if (action === "logout") return logoutCommand(rest, runtime);
  throw usage(`unknown auth action: ${action}`, ["Run `sentry-axi auth --help`"]);
}

export function authHelp() {
  return [
    "Usage:",
    "  sentry-axi auth login [--manual] [--timeout <ms>]",
    "  sentry-axi auth finish --code <code>",
    "  sentry-axi auth logout",
  ].join("\n");
}

async function loginCommand(args, runtime) {
  const parsed = parseFlags(args, { boolean: ["help", "manual"] });
  if (parsed.help) return authHelp();
  try {
    await runtime.client.listTools();
    return { auth: "Sentry MCP already authorized" };
  } catch (error) {
    if (!error.authorizationUrl) throw error;
    if (parsed.manual) {
      return {
        auth: "Sentry MCP OAuth authorization required",
        url: error.authorizationUrl,
        help: ["Open the URL, copy the code, then run `sentry-axi auth finish --code <code>`"],
      };
    }
    return completeLoginWithCallback(error.authorizationUrl, runtime, parsed.timeout);
  }
}

async function finishCommand(args, runtime) {
  const parsed = parseFlags(args, { boolean: ["help"] });
  if (parsed.help) return authHelp();
  if (!parsed.code) throw usage("--code is required", ["Run `sentry-axi auth finish --code <code>`"]);
  await runtime.client.finishAuth(parsed.code);
  return { auth: "Sentry MCP OAuth authorized" };
}

async function logoutCommand(args, runtime) {
  const parsed = parseFlags(args, { boolean: ["help"] });
  if (parsed.help) return authHelp();
  const result = await runtime.client.logoutAuth();
  return {
    auth: result.removed ? "Sentry MCP OAuth credentials cleared" : "Sentry MCP OAuth credentials already absent",
    ...(result.tokenConfigured ? { note: "A token environment variable remains configured" } : {}),
  };
}

async function completeLoginWithCallback(authorizationUrl, runtime, timeoutValue) {
  const timeoutMs = parseTimeout(timeoutValue ?? "300000");
  const callbackUrl = new URL("http://127.0.0.1:14567/oauth/callback");
  const expectedState = new URL(authorizationUrl).searchParams.get("state");
  if (!expectedState) throw usage("OAuth authorization URL did not include state", ["Run `sentry-axi auth login --manual`"]);
  const server = await startOAuthCallbackServer(callbackUrl, timeoutMs, expectedState);

  runtime.stdout?.write?.([
    "auth: Sentry MCP OAuth authorization required",
    `url: ${JSON.stringify(authorizationUrl)}`,
    `callback: ${JSON.stringify(callbackUrl.toString())}`,
    "help[2]:",
    "  Open the URL in a browser",
    "  Use `sentry-axi auth login --manual` if callback capture fails",
    "",
  ].join("\n"));

  try {
    await runtime.client.finishAuth(await server.code);
    return { auth: "Sentry MCP OAuth authorized" };
  } finally {
    await server.close();
  }
}

function parseTimeout(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw usage("--timeout must be a positive number");
  return number;
}

async function startOAuthCallbackServer(callbackUrl, timeoutMs, expectedState) {
  let timeout;
  let settled = false;
  let resolveCode;
  let rejectCode;
  const code = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url, callbackUrl.origin);
    if (url.pathname !== callbackUrl.pathname) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found.\n");
      return;
    }
    const error = url.searchParams.get("error");
    const authCode = url.searchParams.get("code");
    if (url.searchParams.get("state") !== expectedState) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("OAuth state did not match. You can close this tab.\n");
      return;
    }
    if (error || !authCode) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Sentry authorization failed. You can close this tab.\n");
      finish(new Error(error ? `Sentry OAuth error: ${error}` : "OAuth callback did not include a code"));
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("Sentry authorization captured. You can close this tab.\n");
    finish(null, authCode);
  });

  function finish(error, authCode) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (error) rejectCode(error);
    else resolveCode(authCode);
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(callbackUrl.port), callbackUrl.hostname, resolve);
  });
  timeout = setTimeout(() => finish(new Error("Timed out waiting for Sentry OAuth callback")), timeoutMs);
  return { code, close: () => new Promise((resolve) => server.close(resolve)) };
}
