/**
 * Locale- and timezone-independent formatting.
 *
 * Anything rendered during server rendering must not depend on the viewer's
 * locale or timezone, otherwise the server HTML and the hydrated client disagree
 * (React reports "tree hydrated but some attributes … didn't match"). ISO dates
 * are therefore rendered in UTC with a fixed shape.
 */

/** `2026-02-17T09:41:03+00:00` → `2026-02-17` (UTC, stable across locales). */
export function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toISOString().slice(0, 10);
}

/** `…T09:41:03Z` → `09:41:03` (UTC, stable). Used where a timestamp must be deterministic. */
export function formatTimeUtc(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "--:--:--";
  return parsed.toISOString().slice(11, 19);
}
