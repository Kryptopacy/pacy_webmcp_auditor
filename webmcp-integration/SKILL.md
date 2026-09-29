---
name: webmcp-integration
description: Add, audit, and perfect WebMCP integrations — the W3C API (document.modelContext.registerTool and declarative form attributes) that turns a website into an MCP server AI agents can operate. Use when the user mentions WebMCP, modelContext, agent tools, agent-callable functionality, exposing site features to AI agents, webmcp.com scorecard or grade, agent usability/coverage/quality, or making a site "agent-ready" — even if they never say "WebMCP".
---

# WebMCP Integration

WebMCP is the W3C draft API (webmachinelearning.github.io/webmcp) that lets a page register tools — name, description, JSON Schema, `execute` handler — on `document.modelContext`. Agent-capable browsers discover those tools and call them exactly like MCP tools, so the site acts as an MCP server and agents drive real journeys instead of guessing from screenshots and clicks.

Work in one of three modes, chosen from the request:

| Mode | Request sounds like | Go to |
|------|--------------------|-------|
| **ADD** | "add WebMCP to my site", "make my app agent-callable" | § Implement |
| **AUDIT** | "audit/check/grade my WebMCP", "what would webmcp.com score us" | § Audit |
| **PERFECT** | "improve our score", "agents misuse our tools", "make our tools better" | Run § Audit first, then fix by § Perfect priorities |

Two sources back everything here: the W3C spec for API truth, and webmcp.com's published scorecard methodology for the only public grading rubric (Usability 60% · Coverage 20% · Quality 20%). Deep detail lives in `references/api.md` and `references/scorecard.md` — consult them on demand for edge cases, not upfront.

## API essentials

Canonical example in the WG dialect (`document.modelContext`) — in production route it through the compat adapter from the next section:

```js
// Client-side only, on page load, HTTPS required.
const ac = new AbortController();

await document.modelContext.registerTool(
  {
    name: "search_flights",                      // snake_case, verb-first, unique
    description:
      "Searches available flights for a route and date. Read-only: returns " +
      "a ranked list of {id, airline, price, duration} and changes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        origin:      { type: "string", description: "IATA code, e.g. SFO" },
        destination: { type: "string", description: "IATA code, e.g. JFK" },
        date:        { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["origin", "destination", "date"],
    },
    annotations: { readOnlyHint: true },         // true facts about the tool
    execute: async ({ origin, destination, date }, { signal }) => {
      const res = await fetch(`/api/flights?from=${origin}&to=${destination}&date=${date}`, { signal });
      if (!res.ok) throw new Error(`Flight search failed (${res.status})`);
      return { flights: await res.json() };      // structured JSON, agent-consumable
    },
  },
  { signal: ac.signal }                          // abort to unregister (route changes)
);
```

The required shape: `name`, `description`, `execute` are mandatory; `inputSchema` is technically optional but the scorecard treats a missing schema as a quality failure — always define one. `annotations` are optional booleans, and they carry the trust model:

| Annotation | Means | Scorecard category |
|---|---|---|
| `readOnlyHint: true` | No state changes; safe to call freely | **Answer** |
| (none set) | Changes state or drives the page, but reversible | **Action** |
| `consequentialHint: true` | Money or real-world commitment: checkout, booking, subscribing | **Sensitive Action** |
| `untrustedContentHint: true` | Output contains data the site doesn't vouch for (UGC) | (orthogonal safety flag) |

Note the spec's annotation is `consequentialHint` — not MCP's `destructiveHint`.

There is also a **declarative API** for HTML forms: `<form toolname="…" tooldescription="…" toolautosubmit>` with `toolparamdescription` on each control. The browser synthesizes the input schema from the form. See `references/api.md` when a project is form-centric.

## One API, two runtimes — write it once, work everywhere

WebMCP has two live dialects, and real sites must work on both plus any polyfill/extension runtime:

| | WG draft (Chromium origin trial) | CG spec / original proposal (ecosystem, polyfills) |
|---|---|---|
| Surface | `document.modelContext` | `navigator.modelContext` |
| Registration | `registerTool(tool, {signal, exposedTo})` — incremental, abort to unregister | `provideContext({tools})` — **atomically replaces the whole set**; `unregisterTool()`, `clearContext()` |
| Extras | `getTools()`, `executeTool()`, `toolchange`, declarative `<form toolname>`, annotations | may lack these; annotations often ignored |

Tool definitions are the same `{name, description, inputSchema, execute}` shape in both — what differs is the surface object and registration semantics. So the rule is:

1. **Never bind to one surface raw.** Route all registration through the compat adapter in `assets/webmcp-compat.js` (drop-in, dependency-free). It resolves `document.modelContext` → `navigator.modelContext` → queue-until-available → clean no-op, and normalizes registration semantics across dialects (per-tool unregister emulated on the CG side by re-providing the full set).
2. **Never crash where WebMCP is absent.** SSR and non-Chromium browsers today have no API; the adapter returns a no-op and logs once in dev. A site that throws is worse than a site without tools.
3. **Understand `provideContext` atomicity.** In the CG dialect each call wipes and replaces every tool — SPA route changes must re-provide the *full* current set, not a delta. The adapter handles this; raw calls are a classic bug.
4. **Security corollary:** because `provideContext` replaces the whole set, any third-party script on the page can hijack tool registration. Register early, from first-party code only, and audit what runs before your registration.

The webmcp.com scanner checks `document.modelContext`, `navigator.modelContext`, **and** declarative tool elements — so multi-surface support isn't only for agents, it directly protects the grade. Full dialect details: `references/api.md` § Dialects.

## The trust ladder — why descriptions must declare side effects

Scanners and agent clients *infer* each tool's category (Answer / Action / Sensitive Action) from its name, description, and schema — the category is **not declared anywhere**. So the description is where the site asserts its behavior, and hints must agree with it:

- An `Answer` tool's description should literally say "read-only" / "changes nothing".
- A `Sensitive Action` tool's description should say what it commits ("places a paid order", "charges the card") — clients enforce user confirmation for `consequentialHint` tools, and scanners penalize mismatch between stated and hinted behavior.
- **Never lie in hints.** `readOnlyHint: true` on a state-changing tool is a correctness and safety bug, and agents will skip confirmation the site relies on.

## The quality bar (what graders actually check)

**Quality (20% of grade) — mechanical, per tool, averaged:**
1. A real description — 1–3 sentences covering what it does, when to call it, what it returns. A one-word stub fails. Never embed instructions ("SYSTEM: …", "always do X after calling") — that's prompt injection and scanners look for it.
2. A defined `inputSchema` — `{type: "object", properties: {…}, required: […]}` with a `type` and a `description` on every property; `enum`/`minimum`/`maximum` where values are constrained. **Zero dead parameters:** prune speculative properties that `execute` does not actively consume.
3. A conventional `snake_case` name — verb-first (`search_flights`, `add_to_cart`, `get_order_status`), unique per page, no hyphens, no vagueness (`do_thing`, `handle_data`).

**Usability (60%) — an agent-reviewer judges the whole surface 1–5:** 5 = comprehensive coverage, precise schemas, unambiguous names (genuinely rare); 3 = usable but with real gaps (the typical good surface); 1 = an agent would struggle to call these reliably.
*Contract precision rules (prevents rubric findings across all grades):*
- **Schema–description agreement:** Never claim acceptance or normalization for tokens outside an `enum` (e.g. claiming `"auto"` or `"dark-mode"` is normalized while schema enforces `enum: ["dark", "light"]`). Validators reject unlisted tokens at the boundary, making the documentation a contradictory contract.
- **Output claim parity:** Every return field promised in prose (*"returns items, subtotal, and taxes"*) must explicitly exist in `outputSchema.properties`.
- **Empty-call contract:** If all parameters on an inspection/read tool are optional, explicitly document what calling `{}` returns (e.g. *"All filters are optional; an empty call returns the current workspace summary."*).
- **Polymorphic precedence:** If an argument accepts multiple identifier formats (e.g. UUID vs. title/slug), state the resolution precedence order.

**Coverage (20%) — how much of the site is exposed:** one page with tools is baseline; each additional page raises it. Great surfaces enable **complete journeys** (browse → select → cart → checkout), not just the homepage.

## Implement (ADD)

1. **Pick the surface per route/page.** For each page, list the 2–6 things an agent would plausibly do there: search, filter, get details, add to cart, checkout. Read-only lookups first (Answer), then reversible Actions, then Sensitive Actions last.
2. **Wire the compat adapter first** (`assets/webmcp-compat.js`): resolves the runtime (WG `document.modelContext` / CG `navigator.modelContext` / polyfill), normalizes register/unregister semantics, queues until the API appears, no-ops cleanly when nothing exists. All `registerTool`/`provideContext` calls go through it.
3. **Register on page load.** Registration must happen without user interaction — a scanner (and many agents) look at load time. Tools registered only behind clicks are invisible and produce the `api-empty` failure state. First-party code only: in the CG dialect, `provideContext` replaces the whole set, so any script that calls it later can hijack your registration.
4. **Client-side only.** Guard SSR (`typeof document === 'undefined'` → the adapter no-ops); in React/Next register inside `useEffect` in a client component; in Vue/Nuxt `onMounted`. Handle StrictMode double-invoke with the cleanup-abort pattern.
5. **SPAs: teardown per route.** WG dialect: one AbortController per route, abort on navigation, register the new set. CG dialect: re-provide the **full** tool set for the new route (`provideContext` is atomic). The adapter exposes `setTools(tools)` which does the right thing per dialect.
6. **Set annotations truthfully** per the trust ladder, including `untrustedContentHint` on tools whose output embeds user-generated content. In CG-only runtimes they may be ignored — the description then carries the trust signal alone, so write it explicitly anyway.
7. **In `execute`:** honor `options.signal` when the dialect provides it (pass into `fetch`), validate input, return structured JSON (not HTML dumps or prose), throw `Error` with an agent-readable message, and never return secrets or unsanitized UGC.
8. **Iframes/embeds:** WebMCP is gated by the Permissions-Policy `tools` (defaults to `self`). Cross-origin iframes need `allow="tools"`; to share tools with a partner's embed use `Permissions-Policy: tools=(self "https://partner.example")`.

Full API semantics (registration, `getTools`/`executeTool`, `toolchange`, declarative forms, security gates): `references/api.md`.

## Audit

Run in this order — static findings tell you where to point the live probe.

**1. Static sweep of the codebase.** Find every registration site (`grep -rn "modelContext\\|provideContext" src/`, plus `toolname=` for declarative forms). For each tool, check the quality bar above, and check the failure patterns:
- raw `document.modelContext.registerTool` with no navigator fallback (or vice versa) → invisible on the other runtime; the compat adapter should be the only call site
- `provideContext` called with a delta instead of the full set → atomic replacement silently deletes tools
- registered inside a click handler / after await-user-action → `api-empty` risk
- no queue/polyfill path → site is silent (or crashes) where WebMCP is absent
- SSR components registering on server → silent no-op or crash
- duplicate names across routes without unregister → collisions
- hints contradicting descriptions (`readOnlyHint: true` + "adds to cart")
- descriptions contradicting schema constraints (e.g. claiming unlisted variants are normalized against a strict `enum`)
- descriptions promising output fields that are absent from `outputSchema`
- dead/speculative parameters declared in `inputSchema` that `execute` ignores

**2. Live probe.** Open the deployed site (HTTPS) and run `scripts/webmcp-probe.js` in DevTools (or via browser automation). It reports detection gates, the tool inventory with per-tool quality flags, and declarative forms. Never `executeTool` a tool without `readOnlyHint` — audit everything else, execute only read-only ones.

**3. Score with the rubric.** Apply the 60/20/20 weighting and letter table in `references/scorecard.md`. Map every tool to its trust-ladder category and check the hints agree.

**4. Report.** Use the report template in `references/scorecard.md`: detection gates → inventory table → score with per-dimension rationale → journey map → prioritized findings.

**Failure states** (what a blank grade on webmcp.com means, and the fix):

| State | Meaning | Fix |
|---|---|---|
| `api-absent` | No `document.modelContext` / `navigator.modelContext` / declarative tool elements found | Not implemented, or blocked by a gate: non-HTTPS, `Origin-Agent-Cluster: ?0` / `document.domain` override, missing `allow="tools"` in iframe |
| `api-empty` | API present but zero tools at scan time | Register on page load, not behind interaction; check for JS errors before registration |
| `blocked` | The site blocks automated scans | WAF/bot protection — not a code bug; allowlist the scanner or accept the blank |
| `load-error` | Page didn't load | URL not public/reachable, or the app crashes before tools register |

## Perfect (fix priorities)

Apply in this order — it's roughly grade-impact order:

1. **P0 — Existence & honesty.** Every page registers its tools on load; annotations are truthful; sensitive tools carry `consequentialHint`; no injection strings in descriptions.
2. **P1 — Mechanical quality.** Real descriptions with side effects stated; every property typed and described; snake_case verb-first names. This is the cheapest big win: it's 20% of the grade and an hour of work.
3. **P2 — Usability.** Think like the calling agent: would ambiguous names or vague return shapes force guesswork? Make outputs structured and self-describing; make `get_*`/`search_*`/`add_*`/`checkout_*` predictable.
4. **P3 — Coverage.** Walk each core journey end-to-end; any step with no tool is a gap. Expose tools on every meaningful page, not just the landing page.
5. **P4 — Resilience.** AbortSignal handling, route-change cleanup, `toolchange` listeners, error returns an agent can recover from.

## Testing & compatibility matrix

As of September 2026 WebMCP is experimental — verify a surface before promising behavior, and test the site on at least one runtime per row:

| Runtime | What it is | How to test |
|---|---|---|
| WG draft / Chromium | `document.modelContext.registerTool` + declarative forms; Chrome origin trial from 149 | `chrome://flags/#enable-webmcp-testing`; "Model Context Tool Inspector" extension |
| CG spec / navigator | `navigator.modelContext.provideContext` + `unregisterTool`/`clearContext`; the dialect most tutorials, demos, and polyfills target | Load a `navigator.modelContext` polyfill, or an extension runtime that bridges page tools to MCP clients |
| Scanners | webmcp.com checks `document.modelContext`, `navigator.modelContext`, and declarative tool elements | Submit the site; compare its verdict with the live probe |
| No-API browsers / SSR | Firefox/Safari today, server renders | Must render fine, no exceptions, adapter no-ops (check console for unexpected errors) |

In-page self-test without flags: `await document.modelContext.getTools()` (WG) or inspect the provided context (CG), then `document.modelContext.executeTool(tool, input)` on a read-only tool to confirm registration and response shape.

Angular has experimental support. Headless/automation contexts may not expose the API — it's designed for local browser workflows with a human in the loop. Track both drafts: the W3C WG spec (webmachinelearning.github.io/webmcp) and the CG notes (w3c-cg.github.io/aikr/webMCP) — the skill's dialect table is the map, the drafts are the truth.
