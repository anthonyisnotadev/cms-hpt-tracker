'use strict';
/**
 * Minimal OpenRouter JSON client, shared by the stages that need a structured
 * verdict from a model.
 *
 * lib/adjudicate.js predates this and still carries its own copy of the same
 * request shape; new callers (recover-llm, outreach-prep) use this instead of
 * adding a third. Conventions are deliberately identical to adjudicate.js:
 *   - same env var names (OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_PROVIDER_*)
 *   - json_schema by default, downgraded to json_object for providers that
 *     reject a schema with optional properties (Groq, Cerebras)
 *   - never throws: a transport or parse failure comes back as { error }, so a
 *     caller can leave its unit of work unresolved rather than record garbage.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-3.1-8b-instruct';

function providerPrefs() {
  const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const only = list(process.env.OPENROUTER_PROVIDER_ONLY);
  const order = list(process.env.OPENROUTER_PROVIDER_ORDER);
  const ignore = list(process.env.OPENROUTER_PROVIDER_IGNORE);
  const prefs = {};
  if (only.length) prefs.only = only;
  if (order.length) prefs.order = order;
  if (ignore.length) prefs.ignore = ignore;
  if (process.env.OPENROUTER_PROVIDER_ALLOW_FALLBACKS !== undefined) {
    prefs.allow_fallbacks = /^(1|true|yes|on)$/i.test(process.env.OPENROUTER_PROVIDER_ALLOW_FALLBACKS);
  }
  return Object.keys(prefs).length ? prefs : null;
}

/** Groq and Cerebras reject json_schema unless every property is required. */
function forceJsonObject(model, prefs) {
  const has = (arr, n) => Array.isArray(arr) && arr.some(p => {
    const s = String(p || '').toLowerCase();
    return s === n || s.startsWith(n + '/');
  });
  return !!(
    (prefs && (has(prefs.only, 'groq') || has(prefs.only, 'cerebras')
      || has(prefs.order, 'groq') || has(prefs.order, 'cerebras')))
    || /^(groq|cerebras)\//.test(String(model || ''))
  );
}

/**
 * One chat completion, parsed as JSON.
 *
 * @param {object}  o
 * @param {string}  o.system     system prompt
 * @param {string}  o.user       user prompt
 * @param {object}  o.schema     an OpenRouter json_schema object ({ name, strict, schema })
 * @param {string} [o.model]     overrides OPENROUTER_MODEL
 * @param {number} [o.temperature=0]
 * @param {number} [o.timeoutMs=45000]
 * @returns {Promise<{ data: object, model: string } | { error: string }>}
 */
async function chatJson({ system, user, schema, model, temperature = 0, timeoutMs = 45000 }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { error: 'OPENROUTER_API_KEY not set' };
  const mdl = model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const prefs = providerPrefs();

  const body = {
    model: mdl,
    temperature,
    response_format: forceJsonObject(mdl, prefs)
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: schema },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    ...(prefs ? { provider: prefs } : {})
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ac.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) return { error: `openrouter http ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}` };
    const j = await r.json();
    const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!content) return { error: 'empty completion' };
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (_e) {
      const m = String(content).match(/\{[\s\S]*\}/);
      if (!m) return { error: 'unparseable completion' };
      try { parsed = JSON.parse(m[0]); } catch (_e2) { return { error: 'unparseable completion' }; }
    }
    return { data: parsed, model: mdl };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chatJson, providerPrefs, forceJsonObject, ENDPOINT, DEFAULT_MODEL };
