/**
 * Firestore rejects two things LLM output loves to produce:
 *  - nested arrays ("Nested arrays are not allowed") — e.g. facts: [["a","b"]]
 *  - undefined values
 * Every LLM-derived object MUST pass through this before any Firestore write
 * (verified in prod: a gpt-oss storyboard with a nested array killed a whole
 * generation at the "author" step).
 *
 * Rules: nested arrays are flattened into their parent; undefined → null;
 * plain objects are cleaned recursively; primitives pass through.
 */
export function firestoreSafe<T>(value: T): T {
  return clean(value) as T;
}

function clean(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const el of v) {
      const s = clean(el);
      if (Array.isArray(s)) out.push(...s); // flatten array-in-array
      else out.push(s);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = clean(val);
  }
  return out;
}
