import { join } from "node:path";

import { parseFlags, usage } from "../args.ts";
import { findGitRoot, readBindingFile, validateBinding, writeRepoBinding } from "../repo.ts";
import type { Runtime } from "../types.ts";

export async function initCommand(
  args: string[],
  runtime: Runtime,
): Promise<Record<string, unknown> | string> {
  const parsed = parseFlags(args, { boolean: ["help", "force"] });
  if (parsed.help) return initHelp();
  const organization = String(parsed.organization ?? "").trim();
  const project = String(parsed.project ?? "").trim();
  if (!organization || !project)
    throw usage("--organization and --project are required", [
      "Run `sentry-axi init --organization <slug> --project <slug>`",
    ]);
  const root = await findGitRoot(runtime.cwd);
  if (!root)
    throw usage("current directory is not inside a Git repository", ["Run `git init` first"]);
  const path = join(root, ".sentry-project");
  const existing = await readBindingFile(path);
  if (existing && !parsed.force) {
    if (existing.organization === organization && existing.project === project) {
      return { binding: "already initialized", file: path, ...existing };
    }
    throw usage(".sentry-project already contains a different binding", [
      "Rerun the init command with --force to replace it",
    ]);
  }
  const binding = await validateBinding(
    {
      organization,
      project,
      ...(typeof parsed["region-url"] === "string" ? { regionUrl: parsed["region-url"] } : {}),
    },
    runtime,
  );
  await writeRepoBinding(path, binding);
  return { binding: "initialized", file: path, ...binding };
}

export function initHelp() {
  return [
    "Usage:",
    "  sentry-axi init --organization <slug> --project <slug-or-id> [--region-url <url>] [--force]",
  ].join("\n");
}
