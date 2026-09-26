import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { usage } from "./args.ts";
import { callSentryTool, extractData, extractText } from "./lib/mcp-tools.ts";
import type { McpResult, Runtime } from "./types.ts";

export interface RepoBinding {
  organization: string;
  project: string;
  regionUrl?: string;
}

interface EndpointConstraints {
  organization?: string;
  project?: string;
}

export async function findGitRoot(cwd: string): Promise<string | null> {
  let current = resolve(cwd);
  while (true) {
    try {
      await stat(join(current, ".git"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

export async function readRepoBinding(cwd: string): Promise<RepoBinding | null> {
  const root = await findGitRoot(cwd);
  if (!root) return null;
  return readBindingFile(join(root, ".sentry-project"));
}

export async function readBindingFile(path: string): Promise<RepoBinding | null> {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value.organization !== "string" || typeof value.project !== "string")
      throw new Error();
    return {
      organization: value.organization.trim(),
      project: value.project.trim(),
      ...(typeof value.regionUrl === "string" && value.regionUrl.trim()
        ? { regionUrl: value.regionUrl.trim() }
        : {}),
    };
  } catch {
    throw usage(".sentry-project must contain organization and project strings", [
      "Run `sentry-axi init --organization <slug> --project <slug> --force` to repair it",
    ]);
  }
}

export async function writeRepoBinding(path: string, binding: RepoBinding): Promise<void> {
  await writeFile(path, `${JSON.stringify(binding, null, 2)}\n`, "utf8");
}

export function endpointConstraints(url: string): EndpointConstraints {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const index = parts.indexOf("mcp");
    if (index === -1) return {};
    return {
      ...(parts[index + 1] ? { organization: decodeURIComponent(parts[index + 1]) } : {}),
      ...(parts[index + 2] ? { project: decodeURIComponent(parts[index + 2]) } : {}),
    };
  } catch {
    throw usage("Sentry MCP URL is invalid", ["Set SENTRY_AXI_MCP_URL to an absolute HTTP URL"]);
  }
}

export async function validateBinding(
  requested: RepoBinding,
  runtime: Runtime,
): Promise<RepoBinding> {
  const constrained = endpointConstraints(runtime.mcpUrl);
  assertConstraint("organization", requested.organization, constrained.organization);
  assertConstraint("project", requested.project, constrained.project);

  let organization = constrained.organization ?? requested.organization;
  let project = constrained.project ?? requested.project;
  let regionUrl = requested.regionUrl;

  // Discovery queries are fuzzy; only an exact slug match may be saved, otherwise a single
  // near-miss result would silently bind the repository to a different project.
  if (!constrained.organization) {
    const organizations = parseOrganizations(
      await callSentryTool(runtime, "find_organizations", { query: organization }),
    );
    const match = organizations.find((item) => same(item.slug, organization));
    if (!match)
      throw usage(`Sentry organization not found: ${organization}`, [
        ...closeMatches(organizations.map((item) => item.slug)),
        "Run `sentry-axi organizations list`",
      ]);
    organization = match.slug;
    regionUrl ??= match.regionUrl;
  }

  if (!constrained.project) {
    const projects = parseProjectSlugs(
      await callSentryTool(runtime, "find_projects", {
        organizationSlug: organization,
        ...(regionUrl ? { regionUrl } : {}),
        query: project,
      }),
    );
    const matchedProject = projects.find((slug) => same(slug, project));
    if (!matchedProject)
      throw usage(`Sentry project not found: ${requested.project}`, [
        ...closeMatches(projects),
        `Run \`sentry-axi projects list --organization ${organization}\``,
      ]);
    project = matchedProject;
  }

  return { organization, project, ...(regionUrl ? { regionUrl } : {}) };
}

// Current Sentry MCP servers return structured `{ organizations: [...] }`; older ones only markdown.
export function parseOrganizations(result: McpResult): Array<{ slug: string; regionUrl?: string }> {
  const data = extractData(result) as { organizations?: unknown };
  if (Array.isArray(data?.organizations)) {
    return data.organizations.flatMap((item: { slug?: unknown; regionUrl?: unknown }) =>
      typeof item?.slug === "string"
        ? [
            {
              slug: item.slug,
              ...(typeof item.regionUrl === "string" && item.regionUrl
                ? { regionUrl: item.regionUrl }
                : {}),
            },
          ]
        : [],
    );
  }
  const text = extractText(result) ?? "";
  const matches = [
    ...text.matchAll(/^## \*\*([^*]+)\*\*\s*$[\s\S]*?^\*\*Region URL:\*\*\s*(.*)$/gm),
  ];
  return matches.map((match) => ({
    slug: match[1].trim(),
    ...(match[2].trim() ? { regionUrl: match[2].trim() } : {}),
  }));
}

export function parseProjectSlugs(result: McpResult): string[] {
  const data = extractData(result) as { projects?: unknown };
  if (Array.isArray(data?.projects)) {
    return data.projects.flatMap((item: { slug?: unknown }) =>
      typeof item?.slug === "string" ? [item.slug] : [],
    );
  }
  const text = extractText(result) ?? "";
  return [...text.matchAll(/^- \*\*([^*]+)\*\*\s*$/gm)].map((match) => match[1].trim());
}

function assertConstraint(name: string, requested: string, constrained?: string): void {
  if (constrained && !same(requested, constrained)) {
    throw usage(`--${name} conflicts with the MCP URL constraint: ${constrained}`);
  }
}

function same(left: string, right: string): boolean {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function closeMatches(slugs: string[]): string[] {
  return slugs.length > 0 ? [`Similar slugs: ${slugs.slice(0, 5).join(", ")}`] : [];
}
