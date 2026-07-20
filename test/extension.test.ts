import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSentryExtension } from "../src/extension.ts";

type Dispatcher = NonNullable<Parameters<typeof registerSentryExtension>[2]>;
type RegisteredTool = {
  execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }>;
};

function register(dispatch: Dispatcher, closeError?: Error) {
  let tool: RegisteredTool | undefined;
  let closed = false;
  const pi = {
    registerTool: (definition: unknown) => {
      tool = definition as RegisteredTool;
      return definition;
    },
  } as unknown as ExtensionAPI;

  registerSentryExtension(
    pi,
    async (context) => ({
      ...context,
      mcpUrl: "https://example.test/mcp",
      client: {
        listTools: async () => [],
        callTool: async () => ({}),
        close: async () => {
          closed = true;
          if (closeError) throw closeError;
        },
      },
    }),
    dispatch,
  );
  if (!tool) throw new Error("sentry_axi tool was not registered");
  return { tool, closed: () => closed };
}

test("forwards sentry-axi arguments and closes the client", async () => {
  let received;
  const extension = register(async (args) => {
    received = args;
    return { issues: [{ id: "SENTRY-123", title: "Fix auth" }] };
  });

  const result = await extension.tool.execute(
    "call-1",
    { action: "issues", args: ["search", "unresolved errors"] },
    undefined,
    undefined,
    { cwd: "/tmp/project" },
  );

  assert.deepEqual(received, ["issues", "search", "unresolved errors"]);
  assert.match(result.content[0].text, /SENTRY-123/);
  assert.equal(extension.closed(), true);
});

test("maps dashboard to the no-argument command", async () => {
  let received;
  const extension = register(async (args) => {
    received = args;
    return "project: web";
  });

  await extension.tool.execute("call-2", { action: "dashboard" }, undefined, undefined, {
    cwd: "/tmp/project",
  });

  assert.deepEqual(received, []);
});

test("uses manual OAuth login because pi tools cannot stream the browser URL", async () => {
  let received;
  const extension = register(async (args) => {
    received = args;
    return "auth: required";
  });

  await extension.tool.execute(
    "call-3",
    { action: "auth", args: ["login"] },
    undefined,
    undefined,
    { cwd: "/tmp/project" },
  );

  assert.deepEqual(received, ["auth", "login", "--manual"]);
});

test("propagates cancellation to the command runtime", async () => {
  const controller = new AbortController();
  const { promise: dispatchStarted, resolve: markStarted } = Promise.withResolvers<void>();
  const extension = register(async (_args, runtime) => {
    markStarted();
    return new Promise((_resolve, reject) => {
      runtime.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    });
  });

  const execution = extension.tool.execute(
    "call-4",
    { action: "issues" },
    controller.signal,
    undefined,
    { cwd: "/tmp/project" },
  );
  await dispatchStarted;
  controller.abort();

  await assert.rejects(execution, /aborted/);
  assert.equal(extension.closed(), true);
});

test("closes the client and returns a normalized error when dispatch fails", async () => {
  const extension = register(async () => {
    throw new Error("request failed");
  });

  await assert.rejects(
    extension.tool.execute("call-5", { action: "issues" }, undefined, undefined, {
      cwd: "/tmp/project",
    }),
    /error: request failed/,
  );
  assert.equal(extension.closed(), true);
});

test("preserves a dispatch error when client cleanup also fails", async () => {
  const extension = register(async () => {
    throw new Error("request failed");
  }, new Error("cleanup failed"));

  await assert.rejects(
    extension.tool.execute("call-6", { action: "issues" }, undefined, undefined, {
      cwd: "/tmp/project",
    }),
    /request failed/,
  );
});

test("saves oversized pi tool output to a temporary file", async () => {
  const extension = register(async () => `issues: ${"x".repeat(60_000)}`);
  const result = await extension.tool.execute(
    "call-7",
    { action: "issues" },
    undefined,
    undefined,
    { cwd: "/tmp/project" },
  );
  const text = result.content[0].text;
  const outputPath = /Full output saved to: (.+)]$/.exec(text)?.[1];

  assert.match(text, /Output truncated/);
  assert.ok(outputPath);
  await rm(dirname(outputPath), { recursive: true, force: true });
});
