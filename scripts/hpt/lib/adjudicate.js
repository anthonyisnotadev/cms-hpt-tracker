'use strict';
/**
 * LLM adjudication for hospital-name matches that string similarity cannot
 * settle.
 *
 * These are the cases where the score is high but the evidence is thin:
 * "St Mary's Hospital" scores 1.00 against a hospital two thousand miles away,
 * while "Baptist Health Shelby Hospital" and "SHELBY BAPTIST MEDICAL CENTER"
 * are the same building under a new owner. Address and licensing state settle
 * most of these deterministically in `match`; this handles what is left.
 *
 * Env conventions mirror the existing client in server.js:92-103 rather than
 * introducing new names.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM = `You decide whether a hospital price-transparency file entry refers to the same physical hospital as a CMS-registered facility.

Rules:
- Hospital names repeat across the country. "St Mary's Hospital" in Arizona is NOT the same as "St Mary's Hospital" in Virginia.
- Health systems acquire and rename hospitals, so different names CAN be the same facility (e.g. "Baptist Health Shelby Hospital" is "SHELBY BAPTIST MEDICAL CENTER" after an acquisition).
- Decide on the evidence given: city, state, street address, licensing state, and the domain the file is published on.
- A different state is disqualifying unless the address clearly shows otherwise.
- A children's, behavioral, rehabilitation or surgical facility is not the same as the general hospital it shares a name with.

Known rename patterns that ARE the same facility:
- "Rural Emergency Hospital" is a CMS designation created in 2023. A hospital that converted keeps its CCN and building but renames itself, so "Bullock County Hospital" and "Bullock County Rural Emergency Hospital" are the same facility.
- Suffix and descriptor changes: "Medical Center" / "Hospital" / "Health" / "Regional" / "Memorial" are frequently swapped.

Sibling facilities are NOT matches. This is the most common error:
- Being owned by, affiliated with, or part of the same health system does NOT make two facilities the same hospital. A system's file lists many DIFFERENT hospitals.
- "Medical West, an affiliate of UAB Health System" is NOT "University of Alabama Hospital" - they are two separate hospitals in one system.
- If the two names denote different places (different city, different campus, different named facility), answer false even when they share an owner.

Weighing evidence:
- A publishing domain built from THIS hospital's own distinctive name (bullockcountyhospital.com for "Bullock County Hospital") is strong evidence FOR a match.
- A domain belonging to the parent SYSTEM (uabmedicine.org, providence.org, ascension.org) is NOT evidence for any particular hospital - such files list many hospitals.
- Answer "high" confidence when the location evidence agrees, or when the names differ only by a known rename pattern AND nothing contradicts it.
- If you have NO location evidence and the names differ in a way you cannot explain, answer match=false with "low" confidence - not "high". Reserve high confidence for conclusions the evidence actually supports, in either direction.`;

const SCHEMA = {
  name: 'hospital_match',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      match: { type: 'boolean', description: 'true only if the same physical hospital' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      reason: { type: 'string', description: 'one sentence citing the deciding evidence' }
    },
    required: ['match', 'confidence', 'reason'],
    additionalProperties: false
  }
};

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

function buildPrompt(hospital, entry, mrfMeta) {
  const m = mrfMeta || {};
  return [
    'CMS-registered hospital:',
    `  name:    ${hospital.name}`,
    `  address: ${hospital.address || '(unknown)'}`,
    `  city:    ${hospital.city}, ${hospital.state} ${hospital.zip || ''}`.trimEnd(),
    '',
    'Price-transparency file entry:',
    `  location name:       ${entry.locationName || '(none)'}`,
    `  published on domain: ${entry.domain || '(unknown)'}`,
    `  file hospital_name:  ${m.mrfHospitalName || '(not read)'}`,
    `  file address:        ${m.mrfAddress || '(not read)'}`,
    `  file licensing state:${m.mrfLicenseState || '(not read)'}`,
    '',
    'Are these the same physical hospital?'
  ].join('\n');
}

/**
 * Ask the model to rule on one pair. Returns null on any transport failure so
 * the caller can leave the pair unresolved rather than record a false verdict.
 */
async function adjudicatePair(hospital, entry, mrfMeta, { timeoutMs = 45000, model } = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const mdl = model || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct';
  const prefs = providerPrefs();

  const body = {
    model: mdl,
    temperature: 0,
    response_format: forceJsonObject(mdl, prefs)
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: SCHEMA },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildPrompt(hospital, entry, mrfMeta) }
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
    try { parsed = JSON.parse(content); }
    catch (_e) {
      const m = String(content).match(/\{[\s\S]*\}/);
      if (!m) return { error: 'unparseable completion' };
      try { parsed = JSON.parse(m[0]); } catch (_e2) { return { error: 'unparseable completion' }; }
    }
    return {
      match: !!parsed.match,
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
      reason: String(parsed.reason || '').slice(0, 300),
      model: mdl
    };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 160) };
  } finally { clearTimeout(timer); }
}

/**
 * Precision gate. The manifest is precision-first, so only an affirmative
 * high-confidence ruling is allowed to create a row; everything else stays in
 * the gap list with its reason.
 */
function isAccepted(verdict) {
  return !!(verdict && !verdict.error && verdict.match === true && verdict.confidence === 'high');
}

module.exports = { adjudicatePair, isAccepted, buildPrompt, SYSTEM };
