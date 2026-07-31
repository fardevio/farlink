/**
 * Subsequence matching with a locality bonus and a locality *limit*.
 *
 * The limit is the part that matters here. A command palette matches against
 * short command titles, where plain subsequence matching is fine. This matches
 * against a node's accessible name, which on a real page is the whole
 * concatenated text of a record — 200 characters of title, tags, author and
 * timestamp. Over a string that long, almost any four letters appear in order:
 * filtering Lobsters for "rust" matched every story on the page. Requiring the
 * matched characters to sit near each other turns it back into a filter.
 */

export interface FuzzyMatch {
  score: number
  /** Indices in `text` that matched, for highlighting. */
  positions: number[]
}

/**
 * Scores a set of matched positions. Shared by both paths below so the streak
 * and word-boundary bonuses are stated once; they used to live inside the
 * subsequence walk, which is why the contiguous path could not reuse them.
 */
function scoreOf(haystack: string, positions: number[]): number {
  let score = 0
  let streak = 0

  for (let i = 0; i < positions.length; i++) {
    const found = positions[i]!
    if (i > 0 && found === positions[i - 1]! + 1) {
      streak++
      score += 8 + streak * 2
    } else {
      streak = 0
      score += 1
    }

    // Word boundaries are what people actually aim at.
    const prev = found > 0 ? haystack[found - 1]! : " "
    if (found === 0) score += 12
    else if (/[\s\-_/.:]/.test(prev)) score += 8
  }

  // Prefer shorter haystacks when scores are otherwise equal.
  return score - Math.min(20, Math.floor(haystack.length / 12))
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (query === "") return { score: 0, positions: [] }

  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()

  // An exact substring is the strongest match there is and must never be
  // rejected. The subsequence walk below cannot be trusted to find it: indexOf
  // is greedy-leftmost, so one stray early occurrence of the query's first
  // character smears the span past the locality limit and the row is thrown
  // away. Filtering for "install" missed "Introduction, tutorials, samples and
  // how to install"; six of six realistic labels failed the same way, and the
  // row survived only when its *address* happened to contain the query, because
  // the address path has always tested indexOf first.
  const exact = haystack.indexOf(needle)
  if (exact !== -1) {
    const positions = Array.from({ length: needle.length }, (_, i) => exact + i)
    return { score: scoreOf(haystack, positions), positions }
  }

  const positions: number[] = []
  let at = 0

  for (let i = 0; i < needle.length; i++) {
    const found = haystack.indexOf(needle[i]!, at)
    if (found === -1) return null
    positions.push(found)
    at = found + 1
  }

  // Reject matches smeared across the whole string. The allowance grows with
  // the query so that a longer, more specific query can span more text. This
  // applies only to scattered matches — a contiguous hit returned above is
  // never subject to it.
  const first = positions[0]!
  const last = positions[positions.length - 1]!
  if (last - first > needle.length * 4 + 8) return null

  return { score: scoreOf(haystack, positions), positions }
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  textOf: (item: T) => string
): T[] {
  if (query === "") return items
  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, textOf(item))
    if (match) scored.push({ item, score: match.score })
  }
  // Stable: equal scores keep document order, which is what the user sees.
  return scored
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item)
}
