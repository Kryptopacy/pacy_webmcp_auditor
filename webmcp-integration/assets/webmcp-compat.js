/*
 * webmcp-compat.js — dependency-free WebMCP registration adapter.
 * Makes one tool implementation work across every WebMCP surface:
 *   1. WG draft:      document.modelContext.registerTool(tool, {signal, exposedTo})
 *   2. CG spec:       navigator.modelContext.provideContext({tools}) (atomic full-set replace)
 *   3. Late/polyfill: surface may appear after scripts run — registrations queue until it does
 *   4. No API:        clean no-op (SSR, unsupported browsers); never throws, logs once in dev
 *
 * Usage:
 *   import { createWebMCP } from './webmcp-compat.js';
 *   const webmcp = createWebMCP();
 *   webmcp.setTools([{ name, description, inputSchema, annotations, execute }, ...]); // full set per route
 *   // route change / unmount:
 *   webmcp.setTools(nextRouteTools);
 *   webmcp.clear();      // unregister everything
 *
 * Semantics: setTools() takes the FULL set for the current page/route (never a delta).
 * The adapter diffs against the current set: on the WG dialect it registers only new
 * tools and aborts removed ones (clean per-tool lifecycle); on the CG dialect it
 * re-provides the whole set atomically.
 */
export function createWebMCP({ queueTimeoutMs = 10_000, onStatus } = {}) {
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  const notify = (s) => { if (onStatus) onStatus(s); };

  if (!isBrowser) {
    return { setTools() { notify('noop-server'); return Promise.resolve(); },
             clear() { notify('noop-server'); return Promise.resolve(); } };
  }

  let surface = null;            // {kind: 'wg'|'cg', mc}
  let pending = null;            // desired full tool set while surface unresolved
  let registered = new Map();    // WG dialect: name -> AbortController
  let waitStarted = 0;
  let devWarned = false;

  function resolve() {
    if (surface) return surface;
    const d = document.modelContext;
    const n = navigator.modelContext;
    if (d && typeof d.registerTool === 'function') surface = { kind: 'wg', mc: d };
    else if (n && typeof n.provideContext === 'function') surface = { kind: 'cg', mc: n };
    else if (n && typeof n.registerTool === 'function') surface = { kind: 'wg', mc: n }; // hybrid runtime
    return surface;
  }

  function warnOnce(msg) {
    if (!devWarned && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      console.warn('[webmcp-compat]', msg);
      devWarned = true;
    }
  }

  async function applySet(tools) {
    const s = resolve();
    if (!s) return false;

    const defs = tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      execute: t.execute,
    }));

    if (s.kind === 'cg') {
      await s.mc.provideContext({ tools: defs }); // atomic replace — must be the full set
      notify('provided-cg');
      return true;
    }

    // WG dialect: diff-based application.
    const wanted = new Map(defs.map((t) => [t.name, t]));

    for (const [name, ac] of registered) {
      if (!wanted.has(name)) { ac.abort(); registered.delete(name); }
    }
    for (const def of wanted.values()) {
      if (registered.has(def.name)) continue; // unchanged; re-register only on content change if needed
      const ac = new AbortController();
      try {
        await s.mc.registerTool(def, { signal: ac.signal });
        registered.set(def.name, ac);
      } catch (err) {
        warnOnce(`registerTool(${def.name}) failed: ${err && err.message}`);
      }
    }
    notify('registered-wg');
    return true;
  }

  function setTools(tools) {
    pending = tools.slice();
    waitStarted = waitStarted || Date.now();
    return applySet(pending).then((ok) => {
      if (ok) return true;
      if (Date.now() - waitStarted > queueTimeoutMs) { warnOnce('no WebMCP surface found; tools not registered'); return false; }
      return new Promise((res) => setTimeout(() => res(setTools(pending)), 400)); // retry until surface or timeout
    });
  }

  function clear() {
    pending = [];
    if (!surface) return Promise.resolve();
    if (surface.kind === 'cg' && typeof surface.mc.clearContext === 'function') return Promise.resolve(surface.mc.clearContext());
    for (const ac of registered.values()) ac.abort();
    registered = new Map();
    return Promise.resolve();
  }

  return { setTools, clear, get surfaceKind() { return surface && surface.kind; } };
}

/* Global-script usage (no bundler):
   window.createWebMCP = createWebMCP;  — or paste this file and use the module inline. */
if (typeof window !== 'undefined' && !window.createWebMCP) window.createWebMCP = createWebMCP;
