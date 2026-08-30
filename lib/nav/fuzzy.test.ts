import { fuzzyFilter, fuzzyMatch } from "~/lib/nav/fuzzy"

const scoreOf = (query: string, text: string) => fuzzyMatch(query, text)!.score

describe("fuzzyMatch", () => {
  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyMatch("xyz", "abc")).toBeNull()
    expect(fuzzyMatch("abd", "abc")).toBeNull()
    // Order matters: the same letters in the wrong order do not match.
    expect(fuzzyMatch("cab", "abc")).toBeNull()
    expect(fuzzyMatch("aa", "a")).toBeNull()
  })

  it("matches an empty query with a zero score", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] })
  })

  it("reports the matched positions for highlighting", () => {
    expect(fuzzyMatch("ac", "abc")!.positions).toEqual([0, 2])
    expect(fuzzyMatch("bc", "abcabc")!.positions).toEqual([1, 2])
  })

  it("is case-insensitive", () => {
    expect(fuzzyMatch("AB", "abc")!.positions).toEqual([0, 1])
    expect(fuzzyMatch("ab", "ABC")!.positions).toEqual([0, 1])
  })

  it("scores a contiguous run above a scattered one", () => {
    expect(scoreOf("abc", "abcdef")).toBeGreaterThan(scoreOf("abc", "axbxcx"))
  })

  it("rewards longer contiguous runs progressively", () => {
    expect(scoreOf("abcd", "abcdef")).toBeGreaterThan(
      scoreOf("abcd", "abcxdef")
    )
  })

  it("prefers a word-boundary match over one mid-word", () => {
    // Same haystack length, so only the boundary bonus differs.
    expect(scoreOf("f", "new file")).toBeGreaterThan(scoreOf("f", "newfilex"))
    expect(scoreOf("s", "open-settings")).toBeGreaterThan(
      scoreOf("s", "opensettingsx")
    )
  })

  it("treats a prefix match as the strongest boundary", () => {
    expect(scoreOf("s", "settings")).toBeGreaterThan(scoreOf("s", "up sell"))
  })

  it("penalizes longer haystacks so ties break towards short names", () => {
    const short = scoreOf("go", "go")
    const long = scoreOf("go", "go " + "x".repeat(120))
    expect(short).toBeGreaterThan(long)
  })
})

describe("fuzzyFilter", () => {
  const textOf = (item: { text: string }) => item.text

  it("returns the input untouched for an empty query", () => {
    const items = [{ text: "b" }, { text: "a" }]
    const result = fuzzyFilter("", items, textOf)
    expect(result).toBe(items)
    expect(result).toEqual([{ text: "b" }, { text: "a" }])
  })

  it("drops non-matching items", () => {
    const items = [{ text: "Copy link" }, { text: "Open" }, { text: "Close" }]
    expect(fuzzyFilter("cls", items, textOf)).toEqual([{ text: "Close" }])
  })

  it("preserves document order for equal scores", () => {
    const items = [
      { text: "Copy link", id: 1 },
      { text: "Copy link", id: 2 },
      { text: "Copy link", id: 3 }
    ]
    const result = fuzzyFilter("copy", items, (item) => item.text)
    expect(result.map((item) => item.id)).toEqual([1, 2, 3])
  })

  it("sorts better matches first and keeps ties in order", () => {
    const items = [{ text: "Show tabs" }, { text: "Start" }, { text: "Stop" }]
    // Start and Stop both score a contiguous prefix run and tie, so they keep
    // document order; Show tabs only reaches its `t` across a word boundary.
    expect(fuzzyFilter("st", items, textOf).map(textOf)).toEqual([
      "Start",
      "Stop",
      "Show tabs"
    ])
  })

  it("returns an empty list when nothing matches", () => {
    expect(fuzzyFilter("zzz", [{ text: "abc" }], textOf)).toEqual([])
  })
})

describe("locality limit", () => {
  const story =
    "Memory Safety Absolutists c rust zig itsallaboutthebit.com via " +
    "ekuber 4 hours ago | caches | 16 comments"
  const unrelated =
    "I'm running the ICFP programming contest event programming " +
    "eieio.games via abhin4v 15 hours ago | caches | 8 comments"

  it("matches a query that appears as a word", () => {
    expect(fuzzyMatch("rust", story)).not.toBeNull()
  })

  it("rejects a subsequence smeared across the whole string", () => {
    // r-u-s-t all appear in order in this text, tens of characters apart.
    // Plain subsequence matching returned every story on the page.
    expect(fuzzyMatch("rust", unrelated)).toBeNull()
  })

  it("actually narrows a real level", () => {
    const level = [story, unrelated, "Zig by Example zig zigbyexample.org"]
    expect(fuzzyFilter("rust", level, (s) => s)).toEqual([story])
  })

  it("never rejects a query the title contains verbatim", () => {
    // The locality limit used to throw these away. indexOf is greedy-leftmost,
    // so a stray early occurrence of the query's first character smeared the
    // span past the allowance: "install" missed a title ending in "how to
    // install" because the `i` of "Introduction" anchored the match. Six of six
    // realistic labels failed, and the row survived only when its address
    // happened to contain the query too.
    const titles: [string, string][] = [
      ["install", "Introduction, tutorials, samples and how to install"],
      ["rust", "Return to the previous results page for Rust"],
      ["report", "Read the press release and the annual report"],
      ["login", "Legal, privacy and cookie policy · Login"],
      ["docs", "Download our datasheet, or browse the docs"],
      ["pricing", "Product, partners, resources, insights and pricing"]
    ]
    for (const [query, title] of titles) {
      const match = fuzzyMatch(query, title)
      expect(match, `"${query}" in "${title}"`).not.toBeNull()
      // Contiguous, and pointing at the real occurrence.
      const at = title.toLowerCase().indexOf(query)
      expect(match!.positions, query).toEqual(
        Array.from({ length: query.length }, (_, i) => at + i)
      )
    }
  })

  it("allows a longer query to span more text", () => {
    // The allowance grows with query length, so a specific multi-word query
    // still matches across a gap.
    expect(fuzzyMatch("memoryzig", story)).not.toBeNull()
  })
})
