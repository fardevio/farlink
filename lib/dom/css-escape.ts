/** `CSS.escape` with a fallback for the test environment. Selectors are built
 *  from page-controlled strings, so they are never assembled unescaped. */
export function escapeSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value)
  }
  // A leading digit needs a hex escape, not a backslash — `#1abc` is a syntax
  // error either way. Getting this wrong in the fallback means the tests
  // exercise weaker escaping than production and a regression passes CI.
  const escaped = value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)
  return /^[0-9]/.test(escaped)
    ? `\\3${escaped[0]} ${escaped.slice(1)}`
    : escaped
}
