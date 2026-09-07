# webmcp-integration — an agent skill for WebMCP

A packaged [Agent Skill](https://skills.sh) that lets any coding agent (Claude Code, Codex, Cursor, OpenCode, ZCode, and 70+ more) **add, audit, and perfect WebMCP integrations** — the W3C API that turns a website into an MCP server AI agents can operate.

Built from webmcp.com's published scorecard methodology (Usability 60% · Coverage 20% · Quality 20%), the [W3C WebMCP spec](https://webmachinelearning.github.io/webmcp/), and Chrome's implementation docs. Multi-dialect by design: it targets both the WG draft (`document.modelContext.registerTool`) and the CG spec (`navigator.modelContext.provideContext`) plus polyfills, so integrations work everywhere WebMCP can.

## What the agent can do with it

- **ADD** — wire WebMCP into a project correctly from the start: the compat adapter, per-page tool design (search → details → cart → checkout), the Answer/Action/Sensitive-Action trust ladder, SSR/SPA lifecycle patterns.
- **AUDIT** — static sweep of the codebase + a live browser probe (`scripts/webmcp-probe.js`) + a score against the webmcp.com rubric, ending in a prioritized findings report.
- **PERFECT** — grade-ordered fixes: existence & honesty → mechanical quality → usability → coverage → resilience.

## Install

### With the skills CLI (recommended)

```bash
# pick this repo interactively
npx skills add <owner>/<repo>

# or install this skill directly, globally
npx skills add <owner>/<repo> --skill webmcp-integration -g
```

### Without the CLI

Copy the `webmcp-integration/` folder into your agent's skill directory:

```bash
# Claude Code / OpenCode / most agents (user-global)
git clone https://github.com/<owner>/<repo>.git
cp -r <repo>/webmcp-integration ~/.agents/skills/webmcp-integration

# or project-scoped
cp -r <repo>/webmcp-integration .agents/skills/webmcp-integration
```

ZCode also discovers `~/.zcode/skills/`; Claude Code additionally reads `~/.claude/skills/`. Pick whichever your agent documents.

### Use once, without installing

```bash
npx skills use <owner>/<repo>@webmcp-integration | claude
```

## Layout

```
webmcp-integration/
├── SKILL.md                  # entry point: modes, quality bar, trust ladder, dialect rules
├── references/
│   ├── api.md                # W3C IDL, declarative forms, security gates, dialect table
│   └── scorecard.md          # 60/20/20 rubric, letter grades, audit checklists, report template
├── scripts/
│   └── webmcp-probe.js       # DevTools probe: detection gates, tool inventory, quality flags
└── assets/
    └── webmcp-compat.js      # drop-in adapter: one setTools() works on WG + CG + polyfill + no-API
```

## Sources

- [WebMCP Scorecard methodology](https://webmcp.com/methodology) — webmcp.com
- [WebMCP spec (W3C draft)](https://webmachinelearning.github.io/webmcp/) · [spec repo](https://github.com/webmachinelearning/webmcp)
- [Chrome WebMCP docs](https://developer.chrome.com/docs/ai/webmcp)
- [GoogleChromeLabs/webmcp-tools](https://github.com/GoogleChromeLabs/webmcp-tools) — demos, inspector, polyfill

## Status

Experimental and tracking two moving drafts (WG + CG). The skill's dialect table is the map; the drafts are the truth — verify before promising behavior.
