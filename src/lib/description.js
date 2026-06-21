// Compose the structured "description builder" fields into the single
// `description` string stored on a log. Mirrors client/src/lib/description.ts.
//
// Format (labeled lines, only non-empty fields):
//   <summary>
//   Tools: A, B
//   Area: X, Y
//   Status: Completed
//   Ref: PR #142

function uniqClean(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const s = String(v ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function composeDescription(parts = {}) {
  const summary = String(parts.summary ?? '').trim();
  const tools = uniqClean(parts.tools);
  const areas = uniqClean(parts.areas);
  const status = String(parts.status ?? '').trim();
  const reference = String(parts.reference ?? '').trim();

  const lines = [];
  if (summary) lines.push(summary);
  if (tools.length) lines.push(`Tools: ${tools.join(', ')}`);
  if (areas.length) lines.push(`Area: ${areas.join(', ')}`);
  if (status) lines.push(`Status: ${status}`);
  if (reference) lines.push(`Ref: ${reference}`);
  return lines.join('\n');
}
