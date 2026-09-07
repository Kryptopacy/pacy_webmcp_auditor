# WebMCP API reference

Sources: W3C draft spec (webmachinelearning.github.io/webmcp, repo `webmachinelearning/webmcp`), Chrome implementation docs (developer.chrome.com/docs/ai/webmcp), and the declarative API explainer in the spec repo. The spec is a draft — verify against it when behavior matters.

## Interfaces

```
[SecureContext, SameObject] readonly attribute ModelContext modelContext;  // on Document

interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool,
                                  optional ModelContextRegisterToolOptions options = {});
  Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
  Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject = {},
                                 optional ModelContextExecuteToolOptions options = {});
  attribute EventHandler ontoolchange;   // fires when the tool set changes (also cross-iframe)
};
```

- `document.modelContext` is the spec surface. `navigator.modelContext` appears in earlier drafts and in the wild; webmcp.com's scanner checks both. Implement against `document.modelContext`, audit for both.
- `[SecureContext]` — HTTPS only. `[SameObject]` — the getter returns the same instance every time.
- Everything is promise-based; `registerTool` validates and rejects on: empty `name`/`description`, `inputSchema` that fails `JSON.stringify` (circular refs, non-serializable, `toJSON()` returning `undefined`).

## Tool definition

```js
dictionary ModelContextTool {
  required DOMString name;          // agent-facing identifier, unique per document
  USVString title;                  // human-facing label for UIs; localize via Navigator.language
  required DOMString description;   // natural language: what / when / returns
  object inputSchema;               // JSON Schema (draft 2020-12) for the input object
  required ToolExecuteCallback execute;
  ToolAnnotations annotations;
};

callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options);
dictionary ToolExecuteCallbackOptions { required AbortSignal signal; };

dictionary ToolAnnotations {
  boolean readOnlyHint = false;         // true → no state changes, safe to call freely
  boolean untrustedContentHint = false; // true → output contains data the site doesn't vouch for (UGC)
  boolean consequentialHint = false;    // true → significant/real-world/non-reversible: booking a flight, transferring money
};

dictionary ModelContextRegisterToolOptions {
  sequence<USVString> exposedTo;   // origins (within this document's tree) the tool is exposed to
  AbortSignal signal;              // abort → tool is unregistered
};
```

Notes:
- `inputSchema` is optional in the IDL but mandatory in practice: scanners grade it and agents hallucinate without it. Top level `{type: "object", properties: {...}, required: [...]}`.
- There is no `outputSchema` in the shipped draft (open issue in the repo). Return well-structured JSON anyway.
- `execute`'s second argument carries `signal`: the client may cancel an in-flight call (user changed conversation turn). Pass it to `fetch`; reject with the abort reason. The registry also cancels declarative-tool invocations when the form is reset or its tool declaration changes.

### Registration semantics

- **Register on page load.** Tools registered only after user interaction are invisible to load-time scanners and many agents (the `api-empty` failure state).
- **Update path:** `AbortController` + `registerTool(toolDef, {signal})`; on change, `ac.abort()` then re-register. Re-registering the same `name` replaces the tool in Chromium, but abort-then-register is the spec-sanctioned pattern.
- **SPA routes:** one controller per route; abort on navigation. Stale tools from a previous route confuse agents and inflate duplicate names.
- `getTools()` returns `RegisteredTool` snapshots: `{name, title, description, inputSchema (deep copy), window, origin, annotations}`. Use it for self-tests and for in-page agents.
- `executeTool(tool, input, {signal})` invokes a tool programmatically — the in-page testing path. Only run it on `readOnlyHint` tools during audits.

### Iframes and origins

- A tool is registered to its own document; parent frames see child tools per `exposedTo` and the Permissions-Policy.
- Permissions-Policy `tools` **defaults to `self`**. Cross-origin iframes need `allow="tools"` on the iframe element; an embedder site can grant a partner origin via HTTP header `Permissions-Policy: tools=(self "https://partner.example")`.
- `toolchange` events propagate across frames (fired on the traversable's document in document order) — parents can react to child tool updates.

## Declarative API (forms)

Augments standard `<form>`s — for sites whose functionality already lives in forms. The browser compiles the form into a tool with a synthesized input schema.

```html
<form
  toolname="search_cars"
  tooldescription="Performs a car make/model search. Read-only: returns matching listings."
  toolautosubmit>
  <input type="text" name="make"  toolparamdescription="The vehicle's make (e.g., BMW, Ford)" required>
  <input type="text" name="model" toolparamdescription="The vehicle's model (e.g., 330i, F-150)" required>
  <button type="submit">Search</button>
</form>
```

- `toolname` / `tooldescription` → the tool's name / description. Each form control's `name` attribute becomes a schema property; `toolparamdescription` becomes that property's description; `required` maps to `required[]`. Constraint attributes (`min`, `max`, `step`, `pattern`, `<select>` options) feed the synthesized schema's `minimum`/`maximum`/`enum` — exact synthesis is still being specified, so write complete controls.
- `toolautosubmit` (boolean): agent may submit the filled form itself. **Without it**, the browser focuses the submit button and the user reviews + submits manually — the right choice for consequential forms. Style either state with the `:tool-form-active` / `:tool-submit-active` pseudo-classes.
- **Getting a response back to the agent:** in the `submit` handler, when `event.agentInvoked` is true, call `event.preventDefault()` then `event.respondWith(promise)` — the form does not navigate and the promise's resolution value is returned to the agent:

```js
form.addEventListener('submit', async (event) => {
  if (!event.agentInvoked) return;          // normal user submission: do nothing special
  event.preventDefault();
  event.respondWith(doSearch(new FormData(form)).then(r => ({ results: r })));
});
```

- Events `toolactivated` (tool invocation started) and `toolcanceled` (agent cancelled) fire at the `ModelContext` — hooks for highlighting the form or rolling back provisional state.
- Form reset, removal from the DOM, or changes to `toolname`/`tooldescription` cancel in-flight invocations and unregister/re-register the tool.

## Security gates (causes of `api-absent`)

WebMCP APIs are disabled unless **all** hold:

1. **Secure context** — HTTPS (or localhost).
2. **Origin isolation** — `document.domain` must not be relaxed (an `Origin-Agent-Cluster: ?0` header disables WebMCP).
3. **Permissions-Policy `tools`** — allowed for the frame (default `self`; cross-origin iframes need `allow="tools"`).
4. Page is fully active (not in bfcache).

## Dialects & compatibility (why "one spec" is really two)

There are two live drafts and an ecosystem of polyfills/extension runtimes. Tool definitions are the same `{name, description, inputSchema, execute}` shape everywhere; the **surface object and registration semantics differ**.

| | WG draft (Chromium origin trial) | CG spec / original proposal |
|---|---|---|
| Surface | `document.modelContext` | `navigator.modelContext` |
| Register | `registerTool(tool, {signal, exposedTo})` — incremental; abort the signal to unregister; re-registering a name replaces in Chromium | `provideContext({tools})` — **atomic full-set replacement**; `unregisterTool(tool)`, `clearContext()` |
| Introspection | `getTools()`, `executeTool()`, `ontoolchange` | often absent in runtimes/polyfills |
| Declarative forms | yes (`<form toolname>`) | no |
| Annotations | honored (`readOnlyHint`, `untrustedContentHint`, `consequentialHint`) | often ignored — descriptions must carry the trust signal alone |

Consequences for portable code:

1. **Resolve, don't assume.** Detection order: `document.modelContext` (WG) → `navigator.modelContext` (CG or WG-on-navigator) → queue registrations and retry (polyfills and extension runtimes can appear after page scripts run) → clean no-op. Use `assets/webmcp-compat.js`.
2. **`provideContext` is all-or-nothing.** Every call replaces the entire tool set for the page. Incremental adds = re-provide prior tools plus the new one. SPA route changes = re-provide the full route set. Calling it with a delta silently deletes tools.
3. **Unregister emulation.** The CG dialect may expose `unregisterTool`; when it doesn't, emulating per-tool unregister means re-providing the set minus that tool. The WG dialect's AbortSignal path is strictly cleaner — prefer it when present.
4. **Atomic replacement is an attack surface.** Any third-party script on the page can call `provideContext` and swap every tool for malicious ones (descriptions are instructions for the agent). Register early from first-party code, keep the set small, and treat late `provideContext` calls from bundled third-party scripts as an audit finding.
5. **Polyfills fill gaps both ways.** A `navigator.modelContext` polyfill can back onto the WG API or no-op; detect capability per method (`typeof mc.registerTool === 'function'`), not per object.

## Content-injection threats (from the spec's security section)

- **Description injection:** a tool description carrying instructions ("SYSTEM: ignore previous instructions…") manipulates the calling agent. Write descriptions that describe — never instruct. Same for `toolparamdescription`.
- **Output injection:** tool return values reach the model as trusted data. UGC returned by tools (reviews, forum posts, listings) must be sanitized, and the tool should set `untrustedContentHint: true` so clients spotlight or quarantine the payload.
- **Sensitive actions:** clients are expected to enforce mandatory user confirmation before executing `consequentialHint` tools. Don't try to route confirmation through the tool's own description; the hint is the mechanism.

## Browser support & testing (September 2026)

- Draft spec under W3C Web Machine Learning WG with Google, Microsoft, Mozilla, Apple participation. Not a standard; expect change.
- Chrome: origin trial from Chrome 149. Local testing: `chrome://flags/#enable-webmcp-testing` → Enabled → relaunch. "Model Context Tool Inspector" extension (Chrome Web Store) for viewing/calling/validating tools.
- Angular ships experimental support (angular.dev/ai/webmcp). Other frameworks: register manually per the lifecycle patterns in SKILL.md.
- Primarily designed for local browser workflows with a human in the loop; headless/automation exposure may be limited or behind flags.
- Reference demos: `GoogleChromeLabs/webmcp-tools` (pizza-maker and React flight search — imperative; Le Petit Bistro — declarative).
