# WebMCP scorecard — rubric, checklists, report

Distilled from webmcp.com's published methodology (the only public WebMCP grading rubric). Use it to score a surface, write an audit report, and prioritize fixes.

## Final grade = Usability 60% + Coverage 20% + Quality 20%

The scanner loads the site the way an agent would, discovers every WebMCP tool, and evaluates:

- **Usability (60%)** — an agent-reviewer judges the whole tool surface: useful, clearly named, well described, easy to call. Strict 1–5 scale:
  - **5 Exceptional** — comprehensive coverage, precise schemas, unambiguous names. Genuinely rare.
  - **3 Decent** — usable, but with real gaps. The typical good surface.
  - **1 Barely usable** — an agent would struggle to call these reliably.
- **Coverage (20%)** — how much of the site is exposed to agents. One page with tools → baseline; each additional page raises coverage. Great implementations enable complete user journeys, not just the homepage.
- **Quality (20%)** — mechanical hygiene of each tool, averaged across every tool found:
  - a real `description` (not a one-word stub)
  - a defined `inputSchema` the agent can fill
  - a clear, conventional `snake_case` name

### Letter grades

| Grade | Tier | Stars | What it means |
|---|---|---|---|
| A+ | Exceptional | ★★★★★ | Best-in-class agent surface |
| A | Excellent | ★★★★★ | Strong, minor gaps only |
| A− | Very good | ★★★★☆ | Solid surface, a few fixes away |
| B+ | Good | ★★★★☆ | Usable, real room to improve |
| B | Solid | ★★★☆☆ | Works, but gaps an agent will feel |
| B− | Needs work | ★★★☆☆ | Thin or loosely specified |
| C | Early | ★★☆☆☆ | WebMCP detected — the starting line |

A blank grade means one of the failure states: `api-absent`, `api-empty`, `blocked`, `load-error` (diagnosed in SKILL.md § Audit).

## Tool categories (trust ladder)

Every tool is sorted into one of three categories — a trust ladder for how freely an agent may call it. The category is **inferred automatically from the tool's name, description, and input schema** — it is not declared by the site, which is why descriptions must state side effects explicitly.

| Category | Definition | Expected hint | Examples |
|---|---|---|---|
| **Answer** | Read-only, returns information, page untouched. No side effects; safe to call freely. | `readOnlyHint: true` | search, details, availability, policies |
| **Action** | Changes state or drives the page on the user's behalf **without commitment**. Reversible. | (no hint) | carts, filters, forms, navigation, redirects |
| **Sensitive Action** | Involves money or commitment. Highest trust bar — agents must require explicit user confirmation. | `consequentialHint: true` | checkout, booking, ordering, subscribing |

`untrustedContentHint` is orthogonal: set it whenever a tool returns content the site doesn't vouch for (UGC). An audit finding is any tool whose inferred category contradicts its hints (e.g., "adds to cart" described but flagged `readOnlyHint`).

## Static audit checklist

Per tool:
- [ ] `name`: `snake_case`, verb-first, unique across the page, stable across deploys (`search_flights`, `add_to_cart`, `get_order_status`; not `search-web`, `do_thing`, `handleData`)
- [ ] `description`: 1–3 sentences — what it does, when to call it, what it returns; side effects stated explicitly ("read-only", "adds to cart (reversible)", "places a paid order"); no imperative/instructional language, no "SYSTEM:", no keyword stuffing
- [ ] `inputSchema`: present; `type: "object"`; every property has `type` + `description`; `required` list correct; constraints (`enum`, `minimum`/`maximum`, `format`) where values are constrained; serializable (no circular refs — `registerTool` rejects)
- [ ] `annotations` truthful and matching the trust ladder; `untrustedContentHint` on UGC-returning tools
- [ ] `execute` honors `options.signal`; validates input; returns structured JSON; throws `Error` with an agent-readable message; no secrets/PII in outputs; UGC sanitized
- [ ] `title` set and localized if the tool may appear in native UI

Per page/app:
- [ ] Registration runs on page load, not behind user interaction (`api-empty`)
- [ ] SSR-safe: client-only registration (`typeof document !== 'undefined'`, `useEffect`/`onMounted`); StrictMode double-invoke handled
- [ ] SPA routes: stale tools unregistered (AbortController per route); no duplicate names
- [ ] Every core journey covered end-to-end (e.g., search → details → cart → checkout); every meaningful page has tools
- [ ] Security gates hold: HTTPS, no `document.domain`/`Origin-Agent-Cluster: ?0`, Permissions-Policy `tools` (iframe `allow="tools"` / header grants for partners)
- [ ] Declarative forms: `toolname` + `tooldescription` set; every control has `name` + `toolparamdescription`; `required` marked; `toolautosubmit` deliberately chosen (omit it for consequential forms); `submit` handler answers `event.agentInvoked` with `respondWith()`
- [ ] Hints never contradict behavior; no injection strings in descriptions, param descriptions, or outputs

## Live probe (browser)

Run `scripts/webmcp-probe.js` in DevTools on the deployed page (or drive it via browser automation). It outputs a JSON report: detection gates (`isSecureContext`, `crossOriginIsolated`, API presence), the tool inventory with per-tool quality flags, and declarative forms found.

Rules for the live pass:
- Probe right after load **and** after network idle — catching the `api-empty` case requires both.
- Never `executeTool` a tool lacking `readOnlyHint: true`. Executing an Action or Sensitive Action during an audit mutates real user state.
- If the API is absent, check the security gates (HTTPS, origin isolation, Permissions-Policy) before concluding "not implemented" — `document.domain` relaxation and missing `allow="tools"` silently disable the API.
- Automated scan blocked? That's the `blocked` state (WAF/bot protection), not a code bug.

## Scoring worksheet

1. **Quality (20%):** per tool, three binary checks — real description / defined schema / conventional snake_case name. Tool score = passes/3; surface score = average. (Max contribution: full 20% at 3/3 across the board.)
2. **Coverage (20%):** pages with tools, journey completeness. Single homepage tool ≈ floor; each additional meaningful page adds; a fully walkable core journey ≈ full marks.
3. **Usability (60%):** assign 1–5 via the strict scale after simulating an agent walkthrough — could an agent complete each journey using only names/descriptions/schemas/returns? Deduct for ambiguity, missing constraints, guess-inducing returns, hint contradictions.
4. **Overall:** weighted blend → letter via the table above.

Be strict: 5s are rare by design; a solid, honest surface lands B+/A−.

## Audit report template

```markdown
# WebMCP Audit — <site> (<date>)

## Detection
document.modelContext: yes/no · navigator.modelContext: yes/no · declarative forms: N
Secure context: yes/no · origin-isolated: yes/no · Permissions-Policy `tools`: <value>
Registered at load: yes/no · tools found: N (across M pages)

## Inventory
| # | Tool | Page | Category (inferred) | readOnly | consequential | untrusted | Schema | Name ok | Desc ok |
|---|------|------|--------------------|----------|---------------|-----------|--------|---------|---------|

## Score: <letter> (<tier>, <stars>) — <n>/100
- Usability (60%): <x>/5 — <rationale in one sentence>
- Coverage (20%): <x>/5 — <which journeys walk end-to-end, which dead-end>
- Quality (20%): <x>/5 — <top mechanical failures>

## Journey map
browse → ✓ search_flights → ✓ get_fare_details → ✓ add_to_cart → ✗ *no checkout tool*

## Findings
### P0 — <title>
Evidence: <tool/file/line or probe output> · Impact: <grade + agent behavior> · Fix: <concrete change>
### P1 …  ### P2 …

## Verdict
<2 sentences: where the surface stands, the single highest-leverage change.>
```

Findings priorities: **P0** = existence/honesty/trust (missing tools on load, lying hints, unflagged sensitive actions, injection strings) · **P1** = mechanical quality (descriptions, schemas, names) · **P2** = usability and coverage gaps · **P3** = resilience (signal handling, route cleanup, error shape).
