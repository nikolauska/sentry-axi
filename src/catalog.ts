export type Positional = string | { id: string; url: string };

interface SpecOptions {
  required?: string;
  booleans?: string;
  numbers?: string;
  integers?: string;
  arrays?: string;
  enums?: Record<string, string[]>;
  positional?: Positional;
  positionalQuery?: string;
  binary?: boolean;
}

export interface CatalogSpec {
  tool: string;
  params: string[];
  required: string[];
  booleans: string[];
  numbers: string[];
  integers: string[];
  arrays: string[];
  enums: Record<string, string[]>;
  positional?: Positional;
  positionalQuery?: string;
  binary: boolean;
}

function spec(tool: string, params = "", options: SpecOptions = {}): CatalogSpec {
  return {
    tool,
    params: words(params),
    required: words(options.required),
    booleans: words(options.booleans),
    numbers: words(options.numbers),
    integers: words(options.integers),
    arrays: words(options.arrays),
    enums: options.enums ?? {},
    positional: options.positional,
    positionalQuery: options.positionalQuery,
    binary: options.binary ?? false,
  };
}

function words(value = ""): string[] {
  return value ? value.split(/\s+/) : [];
}

const ORG = "organizationSlug regionUrl";
const ISSUE = `${ORG} issueId issueUrl`;

export const CATALOG: Record<string, Record<string, CatalogSpec>> = {
  organizations: {
    list: spec("find_organizations", "query", { positionalQuery: "query" }),
  },
  projects: {
    list: spec("find_projects", `${ORG} query`, {
      required: "organizationSlug",
      positionalQuery: "query",
    }),
    create: spec("create_project", `${ORG} teamSlug name slug platform repository`, {
      required: "organizationSlug teamSlug name",
    }),
    update: spec("update_project", `${ORG} projectSlug name slug platform`, {
      required: "organizationSlug projectSlug",
      positional: "projectSlug",
    }),
    "add-team": spec("add_team_to_project", `${ORG} projectSlug teamSlug`, {
      required: "organizationSlug projectSlug teamSlug",
      positional: "projectSlug",
    }),
    "remove-team": spec("remove_team_from_project", `${ORG} projectSlug teamSlug`, {
      required: "organizationSlug projectSlug teamSlug",
      positional: "projectSlug",
    }),
  },
  teams: {
    list: spec("find_teams", `${ORG} query`, {
      required: "organizationSlug",
      positionalQuery: "query",
    }),
    create: spec("create_team", `${ORG} name`, { required: "organizationSlug name" }),
  },
  dsns: {
    list: spec("find_dsns", `${ORG} projectSlug`, { required: "organizationSlug projectSlug" }),
    create: spec("create_dsn", `${ORG} projectSlug name`, {
      required: "organizationSlug projectSlug name",
    }),
    update: spec(
      "update_dsn",
      `${ORG} projectSlug keyId name isActive rateLimitWindow rateLimitCount disableRateLimit browserSdkVersion loaderHasReplay loaderHasPerformance loaderHasDebug loaderHasFeedback loaderHasLogsAndMetrics`,
      {
        required: "organizationSlug projectSlug keyId",
        booleans:
          "isActive disableRateLimit loaderHasReplay loaderHasPerformance loaderHasDebug loaderHasFeedback loaderHasLogsAndMetrics",
        integers: "rateLimitWindow rateLimitCount",
      },
    ),
  },
  issues: {
    search: spec(
      "search_issues",
      `${ORG} query sort projectSlugOrId limit period includeExplanation`,
      {
        required: "organizationSlug",
        numbers: "limit",
        booleans: "includeExplanation",
        enums: {
          sort: ["date", "freq", "new", "user"],
          period: ["24h", "7d", "14d", "30d", "90d"],
        },
        positionalQuery: "query",
      },
    ),
    view: spec("get_issue_details", `${ISSUE} eventId`, {
      positional: { id: "issueId", url: "issueUrl" },
    }),
    update: spec(
      "update_issue",
      `${ISSUE} status assignedTo ignoreMode ignoreDurationMinutes ignoreCount ignoreWindowMinutes ignoreUserCount ignoreUserWindowMinutes reason`,
      {
        positional: { id: "issueId", url: "issueUrl" },
        integers:
          "ignoreDurationMinutes ignoreCount ignoreWindowMinutes ignoreUserCount ignoreUserWindowMinutes",
        enums: {
          status: ["resolved", "resolvedInNextRelease", "unresolved", "ignored"],
          ignoreMode: [
            "untilEscalating",
            "forever",
            "forDuration",
            "untilOccurrenceCount",
            "untilUserCount",
          ],
        },
      },
    ),
    activity: spec("get_issue_activity", `${ISSUE} includeComments limit`, {
      positional: { id: "issueId", url: "issueUrl" },
      booleans: "includeComments",
      integers: "limit",
    }),
    tags: spec("get_issue_tag_values", `${ISSUE} tagKey`, {
      required: "tagKey",
      positional: { id: "issueId", url: "issueUrl" },
    }),
    reports: spec("get_issue_user_reports", `${ISSUE} cursor limit`, {
      positional: { id: "issueId", url: "issueUrl" },
      integers: "limit",
    }),
    events: spec(
      "search_issue_events",
      `${ISSUE} query sort period projectSlug limit includeExplanation`,
      {
        positional: { id: "issueId", url: "issueUrl" },
        numbers: "limit",
        booleans: "includeExplanation",
      },
    ),
    stacktrace: spec("get_event_stacktrace", `${ORG} issueId eventId thread`, {
      required: "organizationSlug issueId",
      positional: "issueId",
    }),
    note: spec("add_issue_note", `${ISSUE} text`, {
      required: "text",
      positional: { id: "issueId", url: "issueUrl" },
    }),
    analyze: spec("analyze_issue_with_seer", `${ISSUE} instruction`, {
      positional: { id: "issueId", url: "issueUrl" },
    }),
  },
  events: {
    search: spec(
      "search_events",
      `${ORG} dataset query fields sort projectSlug environment period limit includeExplanation`,
      {
        required: "organizationSlug",
        arrays: "fields environment",
        numbers: "limit",
        booleans: "includeExplanation",
        enums: { dataset: ["spans", "errors", "logs", "metrics", "profiles", "replays"] },
        positionalQuery: "query",
      },
    ),
  },
  attachments: {
    list: spec("get_event_attachment", `${ORG} projectSlug eventId`, {
      required: "organizationSlug projectSlug eventId",
      positional: "eventId",
    }),
    download: spec("get_event_attachment", `${ORG} projectSlug eventId attachmentId`, {
      required: "organizationSlug projectSlug eventId attachmentId",
      positional: "eventId",
      binary: true,
    }),
  },
  traces: {
    view: spec("get_trace_details", `${ORG} traceId spanId`, {
      required: "organizationSlug traceId",
      positional: "traceId",
    }),
  },
  replays: {
    view: spec("get_replay_details", `${ORG} replayUrl replayId`, {
      positional: { id: "replayId", url: "replayUrl" },
    }),
  },
  releases: {
    list: spec("find_releases", `${ORG} projectSlug query`, {
      required: "organizationSlug",
      positionalQuery: "query",
    }),
    view: spec(
      "get_release_details",
      `${ORG} releaseVersion projectSlugOrId includeHealth includeDeploys includeCommits limit`,
      {
        required: "organizationSlug releaseVersion",
        positional: "releaseVersion",
        booleans: "includeHealth includeDeploys includeCommits",
        integers: "limit",
      },
    ),
  },
  dashboards: {
    list: spec("find_dashboards", `${ORG} titleQuery sort cursor limit`, {
      required: "organizationSlug",
      integers: "limit",
      enums: { sort: ["title", "-title", "dateCreated", "-dateCreated"] },
    }),
    view: spec("get_dashboard_details", `${ORG} dashboardIdOrTitle`, {
      required: "organizationSlug dashboardIdOrTitle",
      positional: "dashboardIdOrTitle",
    }),
  },
  monitors: {
    list: spec("find_monitors", `${ORG} projectSlug environment owner query limit`, {
      required: "organizationSlug",
      integers: "limit",
      positionalQuery: "query",
    }),
    view: spec(
      "get_monitor_details",
      `${ORG} projectSlugOrId monitorSlug environment period start end checkInLimit includeStats rollupSeconds`,
      {
        required: "organizationSlug monitorSlug",
        positional: "monitorSlug",
        booleans: "includeStats",
        integers: "checkInLimit rollupSeconds",
      },
    ),
  },
  alerts: {
    list: spec("find_alert_rules", `${ORG} kind projectSlug query cursor limit`, {
      required: "organizationSlug",
      integers: "limit",
      enums: { kind: ["all", "issue", "metric"] },
    }),
    view: spec("get_alert_rule", `${ORG} kind projectSlug ruleIdOrName`, {
      required: "organizationSlug ruleIdOrName",
      positional: "ruleIdOrName",
      enums: { kind: ["all", "issue", "metric"] },
    }),
  },
  docs: {
    search: spec("search_docs", "query maxResults guide", {
      required: "query",
      positional: "query",
      integers: "maxResults",
    }),
    view: spec("get_doc", "path", { required: "path", positional: "path" }),
  },
  profiles: {
    analyze: spec(
      "get_profile",
      `${ORG} profileUrl projectSlugOrId transactionName period compareAgainstPeriod focusOnUserCode maxHotPaths`,
      {
        positional: "profileUrl",
        booleans: "focusOnUserCode",
        integers: "maxHotPaths",
      },
    ),
    view: spec(
      "get_profile_details",
      `${ORG} profileUrl projectSlugOrId profileId profilerId start end focusOnUserCode`,
      { positional: "profileUrl", booleans: "focusOnUserCode" },
    ),
  },
  resources: {
    view: spec("get_sentry_resource", "url resourceType resourceId organizationSlug", {
      positional: "url",
      enums: {
        resourceType: [
          "issue",
          "event",
          "trace",
          "span",
          "ai_conversation",
          "breadcrumbs",
          "replay",
          "monitor",
          "snapshot",
          "snapshotImage",
        ],
      },
    }),
  },
  snapshots: {
    latest: spec("get_latest_base_snapshot", `${ORG} appId branch project`, {
      required: "organizationSlug appId",
      positional: "appId",
    }),
    view: spec("get_snapshot", `${ORG} snapshotId showUnmodified`, {
      required: "organizationSlug snapshotId",
      positional: "snapshotId",
      booleans: "showUnmodified",
    }),
    image: spec("get_snapshot_image", `${ORG} snapshotId imageIdentifier imageResolution`, {
      required: "organizationSlug snapshotId imageIdentifier",
      positional: "snapshotId",
      enums: { imageResolution: ["preview", "full"] },
      binary: true,
    }),
  },
  conversations: {
    search: spec(
      "search_ai_conversations",
      `${ORG} query project environment period start end cursor limit`,
      {
        required: "organizationSlug",
        arrays: "project environment",
        integers: "limit",
        positionalQuery: "query",
      },
    ),
    view: spec("get_ai_conversation_details", `${ORG} conversationId project start end`, {
      required: "organizationSlug conversationId",
      positional: "conversationId",
    }),
  },
  tools: {
    search: spec("search_sentry_tools", "query limit", {
      required: "query",
      positional: "query",
      integers: "limit",
    }),
    run: spec("execute_sentry_tool", "name arguments", { required: "name", positional: "name" }),
  },
};

export const MAPPED_TOOL_NAMES: string[] = [
  "whoami",
  ...new Set(
    Object.values(CATALOG).flatMap((actions) => Object.values(actions).map((item) => item.tool)),
  ),
];
