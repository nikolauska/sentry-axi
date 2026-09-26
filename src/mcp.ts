import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { AxiError } from "axi-sdk-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { usage } from "./args.ts";
import { DEFAULT_MCP_URL } from "./config.ts";
import type { InputRecord, McpResult, McpTool } from "./types.ts";

// These failures happen before the request leaves this machine, so nothing can have been applied.
const UNSENT_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);
const MUTATION_NOTE =
  "Before retrying a create or update, inspect the target to check whether it was applied";
const MESSAGE_LIMIT = 200;

export class AuthRequiredError extends AxiError {
  authorizationUrl: string | null;

  constructor(authorizationUrl: string | null) {
    super("Sentry MCP OAuth authorization required", "AUTH_REQUIRED", [
      "Run `sentry-axi auth login`",
      "Run `sentry-axi auth login --manual` if the shell cannot wait for a browser callback",
    ]);
    this.authorizationUrl = authorizationUrl;
  }
}

interface ClientOptions {
  url: string;
  mcpToken?: string;
  sentryToken?: string;
  fetchImpl?: typeof fetch;
  authStorePath?: string;
}

interface OAuthStore {
  state?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

export class SentryMcpClient {
  url: string;
  mcpToken?: string;
  sentryToken?: string;
  fetchImpl?: typeof fetch;
  authStorePath?: string;
  authProvider: SentryOAuthProvider | null;
  client: Client | null = null;
  transport: StreamableHTTPClientTransport | null = null;

  constructor({ url, mcpToken, sentryToken, fetchImpl, authStorePath }: ClientOptions) {
    if (mcpToken && sentryToken) {
      throw usage("SENTRY_AXI_MCP_TOKEN and SENTRY_ACCESS_TOKEN cannot both be set", [
        "Unset one token and retry",
        "Use SENTRY_AXI_MCP_TOKEN for an MCP OAuth access token",
        "Use SENTRY_ACCESS_TOKEN for a Sentry API token",
      ]);
    }
    this.url = url;
    this.mcpToken = mcpToken;
    this.sentryToken = sentryToken;
    this.fetchImpl = fetchImpl;
    this.authStorePath = authStorePath;
    this.authProvider =
      mcpToken || sentryToken ? null : new SentryOAuthProvider({ storePath: authStorePath });
  }

  async connect(): Promise<void> {
    const authorization = authorizationHeader({
      mcpToken: this.mcpToken,
      sentryToken: this.sentryToken,
    });
    this.transport = new StreamableHTTPClientTransport(parseMcpUrl(this.url), {
      requestInit: authorization ? { headers: { authorization } } : undefined,
      authProvider: this.authProvider ?? undefined,
      fetch: this.fetchImpl,
    });
    const client = new Client({ name: "sentry-axi", version: "0.1.0" });
    try {
      await client.connect(this.transport);
    } catch (error) {
      if (this.authProvider?.authorizationUrl)
        throw new AuthRequiredError(this.authProvider.authorizationUrl);
      throw this.translateError(error, false);
    }
    this.client = client;
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    await this.ensureConnected();
    try {
      return (await this.client!.listTools(undefined, { signal })).tools ?? [];
    } catch (error) {
      throw this.translateError(error, false);
    }
  }

  async callTool(name: string, args: InputRecord, signal?: AbortSignal): Promise<McpResult> {
    await this.ensureConnected();
    try {
      return (await this.client!.callTool({ name, arguments: args }, undefined, {
        signal,
      })) as McpResult;
    } catch (error) {
      throw this.translateError(error, true);
    }
  }

  async finishAuth(code: string): Promise<void> {
    this.transport = new StreamableHTTPClientTransport(parseMcpUrl(this.url), {
      authProvider: this.authProvider ?? undefined,
      fetch: this.fetchImpl,
    });
    try {
      await this.transport.finishAuth(code);
    } catch (error) {
      throw this.translateError(error, false);
    }
  }

  // Dependency errors can embed whole HTTP bodies, so only classified, bounded messages reach stdout.
  // `sent` marks calls that may have reached Sentry, where a blind retry could duplicate a mutation.
  translateError(error: unknown, sent: boolean): Error {
    if (error instanceof AxiError) return error;
    const host = new URL(this.url).host;
    const ambiguous = sent ? [MUTATION_NOTE] : [];
    const tokenVariable = this.mcpToken
      ? "SENTRY_AXI_MCP_TOKEN"
      : this.sentryToken
        ? "SENTRY_ACCESS_TOKEN"
        : null;
    const checkUrl = `Check SENTRY_AXI_MCP_URL (default ${DEFAULT_MCP_URL})`;

    if (error instanceof UnauthorizedError) return new AuthRequiredError(null);
    // error_description is the authorization server's user-facing explanation (RFC 6749 §5.2),
    // and without it an `invalid_grant` cannot be told apart from an expired or reused code.
    if (error instanceof OAuthError)
      return new AxiError(
        `Sentry OAuth failed: ${error.errorCode}${error.message ? ` (${boundedMessage(error.message)})` : ""}`,
        "AUTH_ERROR",
        ["Run `sentry-axi auth login` to start a new authorization"],
      );
    if (error instanceof StreamableHTTPError) {
      const status = error.code ?? -1;
      if (status === 401 || status === 403)
        return new AxiError(
          `Sentry MCP rejected the credentials (HTTP ${status})`,
          "AUTH_ERROR",
          tokenVariable
            ? [`Check that ${tokenVariable} is valid, unexpired, and has the needed scopes`]
            : ["Run `sentry-axi auth login` to reauthorize"],
        );
      if (status === 404)
        return new AxiError(
          `Sentry MCP endpoint not found at ${host} (HTTP 404)`,
          "CONNECTION_ERROR",
          [checkUrl],
        );
      if (status === 408 || status === 429 || status >= 500)
        return new AxiError(`Sentry MCP endpoint failed with HTTP ${status}`, "BACKEND_ERROR", [
          "Retry later",
          ...ambiguous,
        ]);
      if (status === -1)
        return new AxiError(
          `Sentry MCP endpoint at ${host} did not return MCP data`,
          "CONNECTION_ERROR",
          [checkUrl],
        );
      return new AxiError(`Sentry MCP endpoint returned HTTP ${status}`, "BACKEND_ERROR", [
        checkUrl,
        ...ambiguous,
      ]);
    }
    if (error instanceof McpError) {
      const message = boundedMessage(error.message.replace(/^MCP error -?\d+: /, ""));
      if (error.code === ErrorCode.InvalidParams)
        return new AxiError(message, "VALIDATION_ERROR", [
          "Run the command with --help to check its flags",
        ]);
      if (error.code === ErrorCode.RequestTimeout)
        return new AxiError("Sentry MCP request timed out", "TIMEOUT", ambiguous);
      if (error.code === ErrorCode.ConnectionClosed)
        return new AxiError("Sentry MCP connection closed", "CONNECTION_ERROR", ambiguous);
      return new AxiError(message, "OPERATION_ERROR", ambiguous);
    }
    if (error instanceof Error && error.name === "AbortError")
      return new AxiError("Sentry MCP request was cancelled", "CANCELLED", ambiguous);
    const networkCode = networkErrorCode(error);
    if (networkCode !== undefined) {
      return UNSENT_NETWORK_CODES.has(networkCode)
        ? new AxiError(`Could not reach the Sentry MCP endpoint at ${host}`, "CONNECTION_ERROR", [
            "Check network access",
            checkUrl,
          ])
        : new AxiError(
            `Connection to the Sentry MCP endpoint at ${host} failed`,
            "CONNECTION_ERROR",
            ["Retry the command", ...ambiguous],
          );
    }
    const message = error instanceof Error ? error.message : String(error);
    return new AxiError(
      `Sentry MCP request failed: ${boundedMessage(message)}`,
      "OPERATION_ERROR",
      ambiguous,
    );
  }

  async logoutAuth(): Promise<{ removed: boolean; tokenConfigured: boolean }> {
    const provider =
      this.authProvider ?? new SentryOAuthProvider({ storePath: this.authStorePath });
    return {
      removed: await provider.deleteStore(),
      tokenConfigured: Boolean(this.mcpToken || this.sentryToken),
    };
  }

  async close(): Promise<void> {
    await this.transport?.close();
  }

  async ensureConnected(): Promise<void> {
    if (!this.client) await this.connect();
  }
}

export class SentryOAuthProvider implements OAuthClientProvider {
  storePath: string;
  authorizationUrl: string | null = null;

  constructor({ storePath }: { storePath?: string } = {}) {
    this.storePath = storePath ?? defaultAuthStorePath();
    this.authorizationUrl = null;
  }

  get redirectUrl(): string {
    return "http://127.0.0.1:14567/oauth/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "sentry-axi",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  // A fresh state per authorization lets the callback reject redirects from older consent pages,
  // which otherwise arrive with a code bound to a different PKCE challenge.
  async state(): Promise<string> {
    const state = randomBytes(24).toString("base64url");
    await this.updateStore({ state });
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.readStore()).clientInformation;
  }
  async saveClientInformation(value: OAuthClientInformationMixed): Promise<void> {
    await this.updateStore({ clientInformation: value });
  }
  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.readStore()).tokens;
  }
  async saveTokens(value: OAuthTokens): Promise<void> {
    await this.updateStore({ tokens: value });
  }
  async redirectToAuthorization(url: URL): Promise<void> {
    this.authorizationUrl = url.toString();
  }
  async saveCodeVerifier(value: string): Promise<void> {
    await this.updateStore({ codeVerifier: value });
  }

  async codeVerifier(): Promise<string> {
    const value = (await this.readStore()).codeVerifier;
    if (!value) throw new Error("No OAuth code verifier saved");
    return value;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
    const store = await this.readStore();
    if (scope === "all" || scope === "client") delete store.clientInformation;
    if (scope === "all" || scope === "tokens") delete store.tokens;
    if (scope === "all" || scope === "verifier") {
      delete store.codeVerifier;
      delete store.state;
    }
    await this.writeStore(store);
  }

  async deleteStore(): Promise<boolean> {
    try {
      await rm(this.storePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async readStore(): Promise<OAuthStore> {
    try {
      return JSON.parse(await readFile(this.storePath, "utf8"));
    } catch {
      return {};
    }
  }

  async updateStore(patch: Partial<OAuthStore>): Promise<void> {
    await this.writeStore({ ...(await this.readStore()), ...patch });
  }

  async writeStore(store: OAuthStore): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.storePath, 0o600);
  }
}

export function authorizationHeader({
  mcpToken,
  sentryToken,
}: {
  mcpToken?: string;
  sentryToken?: string;
}): string | null {
  if (mcpToken && sentryToken) throw usage("Only one token type may be configured");
  if (mcpToken) return `Bearer ${mcpToken}`;
  if (sentryToken) return `Sentry-Bearer ${sentryToken}`;
  return null;
}

function parseMcpUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw usage("Sentry MCP URL is invalid", [
      "Set SENTRY_AXI_MCP_URL to an absolute HTTP or HTTPS URL",
    ]);
  }
}

function boundedMessage(message: string): string {
  const line = message.split("\n", 1)[0].trim();
  return line.length > MESSAGE_LIMIT ? `${line.slice(0, MESSAGE_LIMIT)}...` : line;
}

// Node's fetch reports network failures as `TypeError: fetch failed` with the socket error as cause.
function networkErrorCode(error: unknown): string | undefined {
  if (!(error instanceof TypeError) || error.message !== "fetch failed") return undefined;
  const cause = error.cause as { code?: unknown } | undefined;
  return typeof cause?.code === "string" ? cause.code : "";
}

function defaultAuthStorePath(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "sentry-axi",
    "oauth.json",
  );
}
