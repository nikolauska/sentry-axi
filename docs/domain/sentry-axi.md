# Sentry AXI

> Status: Current behavior, backed by the command catalog and automated tests.

## Purpose

Sentry AXI gives coding agents a stable shell interface to Sentry's remote MCP server. It favors compact, actionable output and repository-aware defaults so an agent can investigate production behavior without loading broad Sentry data by default.

## Product behavior

- The default service is Sentry's hosted MCP endpoint; deployments may configure another HTTP endpoint.
- OAuth is the default interactive authentication path. An MCP access token or Sentry API token may be configured instead, but never both.
- A Git repository may bind one organization and project in `.sentry-project`. The server endpoint may further constrain that scope.
- Search and list operations return compact structured data. Complete content is opt-in with `--full`, and selected fields can be requested with `--select`.
- Binary attachments and snapshot images are written only to an explicit `--output` path.
- The typed command catalog mirrors the known Sentry MCP tool surface. Tool search and execution provide a fallback when the remote server adds a tool before sentry-axi adds a direct command.

## Agent safety boundary

Reading and investigating Sentry data does not require extra confirmation when it follows the user's request. Creating or updating Sentry data requires the user's explicit intent for that mutation. A failed mutation is not assumed to be rolled back; the agent inspects the target before retrying when the outcome is uncertain.

## Terminology

- **Repository binding**: the organization, project, and optional regional URL stored in `.sentry-project`.
- **Endpoint constraint**: organization or project scope encoded in the MCP URL and enforced over local defaults.
- **Direct command**: a stable CLI group and action mapped to one Sentry MCP tool.
- **Tool fallback**: discovery or execution through the server's tool-search facilities when no direct command exists.
