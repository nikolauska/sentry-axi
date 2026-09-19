![sentry-axi](assets/sentry-axi.png)

<h1 align="center">sentry-axi</h1>

`sentry-axi` is an [Agent eXperience Interface (AXI)](https://github.com/kunchenguid/axi) that lets AI agents work with Sentry. It exposes Sentry MCP operations through compact, structured commands designed for token efficiency, predictable errors, and useful next steps.

## Install

sentry-axi requires Node.js 24 or newer. Install it globally with npm:

```sh
npm install -g @nikolauska/sentry-axi
sentry-axi --help
```

## Install the agent skill

Install the marketplace plugin for your agent:

```text
# Claude Code
/plugin marketplace add nikolauska/sentry-axi
/plugin install sentry-axi@sentry-axi

# Codex
codex plugin marketplace add nikolauska/sentry-axi
codex plugin add sentry-axi@sentry-axi

# GitHub Copilot CLI
copilot plugin marketplace add nikolauska/sentry-axi
copilot plugin install sentry-axi@sentry-axi
```

Alternatively, install the portable Agent Skill with the [Skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add nikolauska/sentry-axi -g
```

These options install the agent instructions. The `sentry-axi` command must still be installed separately.

Read [how sentry-axi works](docs/domain/how-sentry-axi-works.md) for the product workflow and [CONTRIBUTING.md](CONTRIBUTING.md) to work on the project. For agent usage, see the [sentry-axi skill](skills/sentry-axi/SKILL.md).
