/*
 * WebMCP audit probe — run in DevTools console on the target page (HTTPS).
 * Reports detection gates, tool inventory with quality flags, and declarative forms.
 * Read-only: it never executes tools (only read-only ones would be safe, and even
 * those are skipped by default — set PROBE_EXECUTE_READ_ONLY = true to allow).
 *
 * Output: console.table summaries + a JSON report copied to clipboard when possible.
 */
(async () => {
  const PROBE_EXECUTE_READ_ONLY = false;
  const SENSITIVE_RE = /\b(checkout|book|booking|order|purchase|pay|payment|subscribe|charge|reserve|reservation|transfer)\b/i;
  const INJECTION_RE = /(system\s*prompt|ignore\s+(all\s+)?previous|important\s*:|instructions\s*:)/i;

  const report = {
    url: location.href,
    probedAt: new Date().toISOString(),
    gates: {
      secureContext: isSecureContext,
      // crossOriginIsolated (COOP/COEP) is NOT a WebMCP gate — false is normal.
      // The origin-isolation gate is document.domain relaxation, tracked below.
      crossOriginIsolated: crossOriginIsolated,
      documentDomainRelaxed: document.domain !== location.hostname || null,
      documentModelContext: 'modelContext' in document,
      navigatorModelContext: 'modelContext' in navigator,
      navigatorProvidesContext: !!(navigator.modelContext && typeof navigator.modelContext.provideContext === 'function'),
    },
    declarativeForms: [],
    tools: [],
    summary: {},
  };

  // Declarative tools: annotated forms.
  report.declarativeForms = [...document.querySelectorAll('form[toolname]')].map((f) => ({
    toolname: f.getAttribute('toolname'),
    tooldescription: f.getAttribute('tooldescription'),
    autosubmit: f.hasAttribute('toolautosubmit'),
    fields: [...f.elements].filter((el) => el.name).map((el) => ({
      name: el.name,
      required: el.required || false,
      documented: el.hasAttribute('toolparamdescription'),
    })),
  }));

  const doc = 'modelContext' in document ? document.modelContext : null;
  const nav = 'modelContext' in navigator ? navigator.modelContext : null;
  // Prefer surfaces with introspection (getTools). CG runtimes may expose provideContext only.
  const api = (doc && typeof doc.getTools === 'function') ? doc
            : (nav && typeof nav.getTools === 'function') ? nav
            : (doc && typeof doc.registerTool === 'function') ? doc
            : (nav && (typeof nav.provideContext === 'function' || typeof nav.registerTool === 'function')) ? nav
            : null;

  if (!api) {
    report.summary.verdict = 'api-absent';
    report.summary.hint = !isSecureContext
      ? 'Non-HTTPS: the API is SecureContext-gated.'
      : report.gates.navigatorProvidesContext
        ? 'Only a provideContext surface was found (CG dialect) with no getTools() introspection — tools may exist but cannot be enumerated by this probe; verify with the runtime/polyfill inspector.'
        : 'API not present. Check implementation, origin isolation, and Permissions-Policy `tools`.';
    finish();
    return;
  }

  let tools = [];
  if (typeof api.getTools !== 'function') {
    report.summary.verdict = 'probe-limited';
    report.summary.hint = 'Surface found but no getTools() introspection (CG dialect) — enumerate tools with the runtime/polyfill inspector instead.';
    finish();
    return;
  }
  try {
    tools = await api.getTools();
    // Re-read after load settles: catches tools registered late (api-empty risk).
    await new Promise((r) => setTimeout(r, 1500));
    tools = await api.getTools();
  } catch (e) {
    report.summary.verdict = 'probe-error';
    report.summary.error = String(e);
    finish();
    return;
  }

  report.tools = tools.map((t, i) => {
    let schema = t.inputSchema;
    if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch { /* leave as string */ } }
    const props = (schema && typeof schema === 'object' && schema.properties) || {};
    const propNames = Object.keys(props);
    const describedProps = propNames.filter((p) => props[p] && props[p].description);
    const nameOk = /^[a-z][a-z0-9_]*$/.test(t.name || '');
    const desc = t.description || '';
    const descOk = desc.trim().length >= 40 && !INJECTION_RE.test(desc);
    const annotations = t.annotations || {};
    const text = `${t.name} ${desc}`.toLowerCase();

    const flags = [];
    if (!nameOk) flags.push('name not snake_case');
    if (!descOk) flags.push(desc.trim().length < 40 ? 'description stub/short' : 'suspicious instructional language in description');
    if (!schema || schema.type !== 'object' || propNames.length === 0) flags.push('missing/empty inputSchema');
    else if (describedProps.length < propNames.length) flags.push(`${propNames.length - describedProps.length} schema property(ies) lack description`);
    if (SENSITIVE_RE.test(text) && !annotations.consequentialHint && !annotations.readOnlyHint)
      flags.push('describes a sensitive action but no consequentialHint');
    if (SENSITIVE_RE.test(text) && annotations.readOnlyHint)
      flags.push('CONTRADICTION: readOnlyHint but name/description suggests money/commitment');
    if ((annotations.readOnlyHint ? 1 : 0) + (annotations.consequentialHint ? 1 : 0) > 1)
      flags.push('CONTRADICTION: readOnlyHint + consequentialHint');

    return {
      n: i + 1,
      name: t.name,
      origin: t.origin,
      category: annotations.consequentialHint ? 'Sensitive Action'
              : annotations.readOnlyHint ? 'Answer' : 'Action',
      readOnly: !!annotations.readOnlyHint,
      consequential: !!annotations.consequentialHint,
      untrusted: !!annotations.untrustedContentHint,
      schema: schema && schema.type === 'object' ? `${propNames.length} props / ${(schema.required || []).length} required` : 'MISSING',
      nameOk, descOk,
      flags: flags.join('; ') || 'ok',
    };
  });

  const ok = (arr) => arr.filter(Boolean).length;
  report.summary = {
    verdict: report.tools.length === 0 ? 'api-empty — API present but no tools registered at scan time (register on page load)' : 'detected',
    toolCount: report.tools.length,
    nameOk: ok(report.tools.map((t) => t.nameOk)),
    descOk: ok(report.tools.map((t) => t.descOk)),
    withSchema: ok(report.tools.map((t) => t.schema !== 'MISSING')),
    categories: report.tools.reduce((m, t) => ((m[t.category] = (m[t.category] || 0) + 1), m), {}),
    declarativeFormCount: report.declarativeForms.length,
    qualityDenominator: report.tools.length + report.declarativeForms.length,
  };

  if (PROBE_EXECUTE_READ_ONLY) {
    const ro = tools.find((t) => t.annotations && t.annotations.readOnlyHint);
    if (ro) {
      try { report.readOnlySmokeTest = { name: ro.name, note: 'call manually with a minimal input; response shape feeds the usability score' }; } catch { /* noop */ }
    }
  }

  finish();

  function finish() {
    console.table(report.tools.length ? report.tools : [['no tools found']]);
    console.table(report.declarativeForms.map((f) => ({ toolname: f.toolname, autosubmit: f.autosubmit, fields: f.fields.length })));
    console.log(JSON.stringify(report, null, 2));
    try { copy(JSON.stringify(report, null, 2)); console.info('%cReport copied to clipboard.', 'color:#0284c7'); } catch { /* non-secure or unsupported */ }
  }
})();
