import { NavSession } from "~/lib/nav/session"
import { html, recordingHost, rect } from "~/test/harness"

function storyList(count = 4) {
  const rows = Array.from(
    { length: count },
    (_, i) =>
      `<div class="row" data-rect="0,${i * 60},700,50">` +
      `<a href="https://example.com/s/${i}">Story headline number ${i}</a>` +
      `<span class="meta">meta line ${i}</span></div>`
  ).join("")
  return html(
    `<div class="list" data-rect="0,0,700,${count * 60}">${rows}</div>`
  )
}

describe("movement", () => {
  it("moves between siblings and clamps at the ends", () => {
    const root = storyList()
    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.open()

    expect(session.project().cursorIndex).toBe(0)

    session.move(1)
    expect(session.project().cursorIndex).toBe(1)

    session.move(-5)
    expect(session.project().cursorIndex).toBe(0)

    session.last()
    const { items, cursorIndex } = session.project()
    expect(cursorIndex).toBe(items.length - 1)

    session.move(1)
    expect(session.project().cursorIndex).toBe(items.length - 1)
  })
})

describe("filtering", () => {
  it("narrows the level and pulls the cursor into the match set", () => {
    const root = storyList(6)
    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.open()
    session.move(5)

    session.beginFilter()
    session.setFilter("number 1")

    const projection = session.project()
    expect(projection.mode).toBe("filter")
    expect(projection.items).toHaveLength(1)
    expect(projection.cursorIndex).toBe(0)
    expect(projection.items[0]!.name).toContain("number 1")
  })

  it("restores the full level when the filter is cancelled", () => {
    const root = storyList(6)
    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.open()

    session.beginFilter()
    session.setFilter("number 3")
    expect(session.project().items).toHaveLength(1)

    session.cancelFilter()
    expect(session.project().items).toHaveLength(6)
    expect(session.project().mode).toBe("normal")
  })
})

describe("degraded anchors", () => {
  it("requires a second press before acting on a moved cursor", () => {
    const root = storyList()
    const { host, opened } = recordingHost()
    const session = new NavSession(host, root)
    session.open()

    // Replace the list with unrelated content: the cursor can only fall back
    // to a surviving ancestor, which must not be activatable.
    root.querySelector(".list")!.replaceChildren()
    session.reconcile()

    expect(session.project().quality).not.toBe("exact")

    session.openTargets(true)
    expect(opened).toHaveLength(0)
    expect(session.project().awaitingConfirm).toBe(true)
    expect(session.project().status).toBe("Cursor moved, repeat to confirm")

    // Confirmed. There are no links left, so nothing opens, but the guard
    // must have been consumed rather than blocking forever.
    session.openTargets(true)
    expect(session.project().awaitingConfirm).toBe(false)
  })
})

describe("reporting what actually opened", () => {
  /** A host whose worker refuses everything, with a given reason. */
  const refusingHost = (reason: "not-web" | "throttled" | "failed") => {
    const base = recordingHost()
    const asked: string[] = []
    return {
      ...base,
      asked,
      host: {
        ...base.host,
        openUrls: (urls: [string, ...string[]]) => {
          urls.forEach((url) => asked.push(url))
          return Promise.resolve({
            results: urls.map((url) => ({
              url,
              opened: false as const,
              reason
            }))
          })
        }
      }
    }
  }

  it("says it opened a tab only once the worker says so", async () => {
    const { host } = recordingHost()
    const session = new NavSession(host, storyList())
    session.open()

    session.openTargets(true)
    // Before the round-trip completes the panel states intent, not outcome.
    expect(session.project().status).toBe("Opening tab…")
    await Promise.resolve()
    expect(session.project().status).toBe("Opened tab")
  })

  it("does not claim success when the worker opened nothing", async () => {
    // The bug this exists for. `mailto:` and `tel:` links are indexed and shown
    // deliberately — formatUrl has a branch for them — and the worker refuses
    // to hand a non-http scheme to the platform. It used to reply `{ok: true}`
    // from outside its loop, and the panel said "Opened tab" before the message
    // was even sent. Measured live: the URL reached the worker and no tab opened.
    const { host, asked } = refusingHost("not-web")
    const session = new NavSession(host, storyList())
    session.open()

    session.openTargets(true)
    await Promise.resolve()
    expect(asked).toHaveLength(1)
    expect(session.project().status).toBe(
      "Only http and https links open in a tab"
    )
  })

  it("distinguishes the tab ceiling from a refusal", async () => {
    const { host } = refusingHost("throttled")
    const session = new NavSession(host, storyList())
    session.open()

    session.openTargets(true)
    await Promise.resolve()
    expect(session.project().status).toBe("Too many tabs at once, try again")
  })

  it("distinguishes an unreachable worker from a refusal", async () => {
    // sendToWorker resolves null when the port closed — an asleep or dead
    // worker. That is not the same as "the worker said no" and must not read
    // like one.
    const base = recordingHost()
    const host = { ...base.host, openUrls: () => Promise.resolve(null) }
    const session = new NavSession(host, storyList())
    session.open()

    session.openTargets(true)
    await Promise.resolve()
    expect(session.project().status).toBe("Could not reach the extension")
  })
})

describe("checkpointing", () => {
  it("serializes a cursor without live references", () => {
    const root = storyList()
    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.open()

    const stored = session.serializeCursor()
    expect(stored).not.toBeNull()
    expect(JSON.stringify(stored)).toContain("ancestorRoles")
    expect(stored).not.toHaveProperty("ref")
    expect(stored).not.toHaveProperty("ancestorRefs")
  })
})

describe("initial cursor placement", () => {
  it("starts on the dominant record set, not the first one", () => {
    // GitHub's trending page shape: a filter row of three dropdowns appears
    // in `main` before the repository list. Document order would put the
    // cursor on a filter dropdown; the list is what the user came for.
    const filters = [0, 1, 2]
      .map(
        (i) =>
          `<div class="filter" data-rect="${620 + i * 170},340,160,30">` +
          `<span>Filter ${i}</span><a href="/f/${i}">choose</a></div>`
      )
      .join("")
    const repos = Array.from(
      { length: 12 },
      (_, i) =>
        `<article data-rect="0,${390 + i * 100},980,90">` +
        `<h2><a href="/r/${i}">owner / repository-number-${i}</a></h2>` +
        `<p>A description of repository number ${i} that reads like prose.</p>` +
        `</article>`
    ).join("")

    const root = html(`
      <div data-rect="0,0,980,1600">
        <header data-rect="0,0,980,60"><a href="/">Site header link</a></header>
        <main data-rect="0,80,980,1500">
          <h1 data-rect="0,80,980,40">Trending</h1>
          <div class="filters" data-rect="620,340,500,30">${filters}</div>
          <div class="box" data-rect="0,390,980,1200">${repos}</div>
        </main>
      </div>
    `)

    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.setView("structure")
    session.open()

    expect(session.cursorElement?.tagName).toBe("ARTICLE")
    expect(session.cursorElement?.textContent).toContain("repository-number-0")
  })

  it("never opens on the main landmark itself", () => {
    const root = html(`
      <div data-rect="0,0,980,900">
        <header data-rect="0,0,980,60"><a href="/">Header</a></header>
        <main data-rect="0,80,980,700">
          <h1 data-rect="0,80,980,40">A documentation page title</h1>
          <p data-rect="0,130,980,80">Some introductory prose goes here.</p>
        </main>
        <footer data-rect="0,800,980,60"><a href="/x">Footer</a></footer>
      </div>
    `)

    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.setView("structure")
    session.open()

    expect(session.cursorElement?.tagName).not.toBe("MAIN")
    // The level the cursor lands on is inside main, not the landmark itself.
    expect(session.cursorElement?.closest("main")).not.toBeNull()
  })
})

describe("short record sets do not hijack the cursor", () => {
  it("opens at the top of an article, not on its See-also list", () => {
    // Found on MDN: a six-item "See also" list at the bottom of the page was
    // the only record set, so the cursor opened there — past the entire
    // article the user came to read.
    const seeAlso = Array.from(
      { length: 6 },
      (_, i) =>
        `<li data-rect="0,900,600,40"><a href="/s/${i}">Related page ${i}</a></li>`
    ).join("")

    const root = html(`
      <div data-rect="0,0,900,1200">
        <main data-rect="0,0,900,1100">
          <h1 data-rect="0,0,900,50">MutationObserver</h1>
          <p data-rect="0,60,900,120">The MutationObserver interface provides
          the ability to watch for changes made to the DOM tree.</p>
          <h2 data-rect="0,820,900,40">See also</h2>
          <ul data-rect="0,880,600,260">${seeAlso}</ul>
        </main>
      </div>
    `)

    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.setView("structure")
    session.open()

    expect(session.cursorElement?.tagName).toBe("H1")
  })
})

describe("opening never moves the page", () => {
  it("ignores a huge record set that is below the fold", () => {
    const root = html(`
      <div data-rect="0,0,900,9000">
        <main data-rect="0,0,900,9000">
          <h1 data-rect="0,10,900,40">An article</h1>
          <p data-rect="0,60,900,400">The opening paragraph, plainly visible.</p>
          <ul data-rect="0,7000,900,1800">
            ${Array.from(
              { length: 40 },
              (_, i) =>
                `<li data-rect="0,${7000 + i * 40},900,36"><a href="/l/${i}">Language ${i}</a></li>`
            ).join("")}
          </ul>
        </main>
      </div>
    `)
    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.setView("structure")
    session.open()

    const rect = session.cursorElement?.getAttribute("data-rect") ?? ""
    expect(Number(rect.split(",")[1])).toBeLessThan(800)
  })

  it("does not scroll until the user moves deliberately", () => {
    const root = storyList()
    const { host, revealed } = recordingHost()
    const session = new NavSession(host, root)
    session.open()

    // Opening places a cursor. Nothing has been asked for yet, so nothing moves.
    expect(session.cursorElement).not.toBeNull()
    expect(revealed).toHaveLength(0)

    // Typing pulls the cursor to the best match — still not a request to move.
    session.beginFilter("s")
    expect(revealed).toHaveLength(0)

    // An arrow press is.
    session.move(1)
    expect(revealed).toHaveLength(1)
  })

  it("does not reveal again when Up is pressed on the first row", () => {
    // Found on Unsplash: the cursor stayed on Home, but each Up still called
    // reveal → scrollIntoView and the sticky header dragged the page down.
    const root = storyList()
    const { host, revealed } = recordingHost()
    const session = new NavSession(host, root)
    session.open()

    session.move(-1)
    session.move(-1)
    expect(revealed).toHaveLength(0)

    session.move(1)
    expect(revealed).toHaveLength(1)
    session.move(-1)
    session.move(-1)
    // Back on the first row: further Ups must not re-reveal.
    expect(revealed).toHaveLength(2)
  })

  it("puts the page back if the user leaves without following anything", () => {
    const root = storyList()
    const { host, scroll } = recordingHost()
    scroll.at = 4200

    const session = new NavSession(host, root)
    session.open()
    session.move(1)
    session.move(1)

    session.close()
    // The objection to revealing was never that the page moved — it was losing
    // your place. This is what makes it safe.
    expect(scroll.restored).toBe(true)
    expect(scroll.at).toBe(4200)
  })

  it("leaves the page alone when the user followed a link", () => {
    const root = storyList()
    const { host, scroll } = recordingHost()
    scroll.at = 4200

    const session = new NavSession(host, root)
    session.open()
    session.move(1)
    session.activate()
    session.close()

    // They wanted to be somewhere else; restoring would undo it.
    expect(scroll.restored).toBe(false)
  })
})

describe("chrome is not a landing spot", () => {
  it("skips navigation that lives inside main", () => {
    // Wikipedia puts the article tabs, page tools and appearance panel inside
    // <main>, so "first visible named node in main" landed the cursor on the
    // "Main Page / Talk" tab strip.
    const root = html(`
      <div data-rect="0,0,1000,900">
        <main data-rect="0,0,1000,900">
          <nav data-rect="0,10,300,30">
            <ul data-rect="0,10,300,30">
              <li data-rect="0,10,140,30"><a href="/wiki/Main">Main Page</a></li>
              <li data-rect="150,10,80,30"><a href="/wiki/Talk">Talk</a></li>
            </ul>
          </nav>
          <div role="toolbar" data-rect="600,10,380,30">
            <a href="#read" data-rect="600,10,90,30">Read</a>
            <a href="#edit" data-rect="700,10,120,30">View source</a>
          </div>
          <h1 data-rect="0,60,1000,44">Welcome to Wikipedia</h1>
          <p data-rect="0,120,1000,60">The free encyclopedia anyone can edit.</p>
        </main>
      </div>
    `)

    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.setView("structure")
    session.open()

    expect(session.cursorElement?.tagName).toBe("H1")
  })

  it("still lands somewhere when the whole viewport is chrome", () => {
    const root = html(`
      <div data-rect="0,0,1000,900">
        <main data-rect="0,0,1000,900">
          <nav data-rect="0,10,300,30">
            <a href="/a" data-rect="0,10,140,30">Only a nav link</a>
          </nav>
        </main>
      </div>
    `)

    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.setView("structure")
    session.open()

    expect(session.cursorElement).not.toBeNull()
  })
})

describe("filtering by address", () => {
  function mixedLinks() {
    return html(
      `<div class="list" data-rect="0,0,700,240">` +
        `<a href="https://example.com/docs/install" data-rect="0,0,700,20">Getting started</a>` +
        `<a href="https://example.com/blog/2019/hello" data-rect="0,30,700,20">A post</a>` +
        `<a href="https://github.com/far/cmd" data-rect="0,60,700,20">Source</a>` +
        `</div>`
    )
  }

  it("matches a query that only appears in the URL", () => {
    const { host } = recordingHost()
    const session = new NavSession(host, mixedLinks())
    session.open()
    session.beginFilter()

    // Half of what you know about a link is in its address. Nothing here is
    // titled "docs".
    session.setFilter("docs")
    const { items } = session.project()
    expect(items).toHaveLength(1)
    expect(items[0]!.name).toBe("Getting started")
  })

  it("still matches on the title", () => {
    const { host } = recordingHost()
    const session = new NavSession(host, mixedLinks())
    session.open()
    session.beginFilter()

    session.setFilter("post")
    expect(session.project().items).toHaveLength(1)
    expect(session.project().items[0]!.name).toBe("A post")
  })

  it("marks the matched characters in whichever column they fell", () => {
    const { host } = recordingHost()
    const session = new NavSession(host, mixedLinks())
    session.open()
    session.beginFilter()

    session.setFilter("github")
    const item = session.project().items[0]!
    // A row that matched only in its address must show why, or it reads as an
    // arbitrary result.
    expect(item.match).toEqual([])
    expect(item.urlMatch.length).toBe(6)
    expect(item.urlMatch.map((i) => item.url![i]).join("")).toBe("github")
  })
})

describe("the panel is part of the geometry", () => {
  it("does not open the cursor on a link the panel is covering", () => {
    // Two links: one high on the page, one down in the panel's corner.
    const root = html(
      `<div class="list" data-rect="0,0,1400,900">` +
        `<a href="https://example.com/a" data-rect="900,700,300,20">Beside the panel</a>` +
        `<a href="https://example.com/b" data-rect="100,700,300,20">Behind the panel</a>` +
        `</div>`
    )
    const { host } = recordingHost()

    const blind = new NavSession({ ...host }, root)
    blind.open()
    expect(blind.project().items[blind.project().cursorIndex]!.name).toBe(
      "Beside the panel"
    )

    // Same page, but now with the panel where it actually is. The first link
    // in document order is unchanged; what changed is that one of them is
    // under 430 px of opaque… translucent… panel.
    const seeing = new NavSession(
      { ...host, obstruction: () => rect(20, 450, 840, 430) },
      root
    )
    seeing.open()
    const projection = seeing.project()
    expect(projection.items[projection.cursorIndex]!.name).toBe(
      "Beside the panel"
    )
  })
})

describe("ranking titles against addresses", () => {
  it("puts an exact run in the address above a scattered title match", () => {
    const root = html(
      `<div class="list" data-rect="0,0,700,120">` +
        `<a href="https://itsallaboutthebit.com" data-rect="0,0,700,20">itsallaboutthebit.com</a>` +
        `<a href="https://news.ycombinator.com/item?id=49054224" data-rect="0,30,700,20">85 comments</a>` +
        `</div>`
    )
    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.open()
    session.beginFilter()

    // "item" is in the first title only as i-t...t-h-e...m, scattered across
    // twenty characters; it is an exact run in the second address. Tiering
    // titles above addresses put eight rows of the former above every one of
    // the latter.
    session.setFilter("item")
    const { items } = session.project()
    expect(items[0]!.name).toBe("85 comments")
    expect(items[0]!.urlMatch.length).toBe(4)
  })

  it("still prefers a title when the title is the better match", () => {
    const root = html(
      `<div class="list" data-rect="0,0,700,120">` +
        `<a href="https://example.com/a/b/report" data-rect="0,0,700,20">Something else</a>` +
        `<a href="https://example.com/x" data-rect="0,30,700,20">Report</a>` +
        `</div>`
    )
    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.open()
    session.beginFilter()

    session.setFilter("report")
    const { items } = session.project()
    expect(items[0]!.name).toBe("Report")
    expect(items[0]!.match.length).toBe(6)
  })
})

describe("a page that was still loading", () => {
  it("takes a cursor once content arrives", () => {
    // Opening on an empty page leaves no cursor, and re-anchoring cannot
    // restore what was never there — so the list filled in as the page loaded
    // and nothing was ever selected.
    const root = html(`<div class="list" data-rect="0,0,700,20"></div>`)
    const { host } = recordingHost()
    const session = new NavSession(host, root)
    session.open()
    expect(session.cursorElement).toBeNull()

    const link = root.ownerDocument.createElement("a")
    link.setAttribute("href", "https://example.com/late")
    link.setAttribute("data-rect", "0,0,700,20")
    link.textContent = "Arrived late"
    root.firstElementChild!.appendChild(link)

    session.reconcile()
    expect(session.cursorElement).toBe(link)
    expect(session.project().cursorIndex).toBe(0)
  })
})

describe("following a fragment on this page", () => {
  function anchored() {
    return html(
      `<div class="list" data-rect="0,0,700,40">` +
        `<a href="${document.baseURI}#Geography" data-rect="0,0,700,20">Geography</a>` +
        `<a href="https://example.com/away" data-rect="0,20,700,20">Away</a>` +
        `</div>`
    )
  }

  it("does not claim to be opening anything", () => {
    const { host } = recordingHost()
    const session = new NavSession(host, anchored())
    session.open()

    session.activate()
    // The browser jumps and nothing unloads. Dimming the list and saying
    // "Opening…" invented a transition where the point is that there is none.
    expect(session.project().busy).toBe(false)
  })

  it("still shows progress for a real navigation", () => {
    const { host } = recordingHost()
    const session = new NavSession(host, anchored())
    session.open()
    session.move(1)

    session.activate()
    expect(session.project().busy).toBe(true)
  })
})

describe("the settings view", () => {
  function withHost() {
    const changed: [string, number][] = []
    const opened: string[] = []
    const { host } = recordingHost()
    const session = new NavSession(
      {
        ...host,
        hostSettings: () => [
          { key: "theme", label: "Theme", value: "Far Manager" },
          { key: "github", label: "GitHub", value: "a/b", openable: true }
        ],
        changeSetting: (key, delta) => changed.push([key, delta]),
        openSetting: (key) => opened.push(key)
      },
      storyList()
    )
    session.open()
    return { session, changed, opened }
  }

  it("shows every setting's current value", () => {
    // The value goes where a link's address goes, so it renders through the
    // same row and is the thing a settings list exists to tell you.
    const { session } = withHost()
    session.openSettings()
    expect(session.project().items.map((i) => [i.name, i.url])).toEqual([
      ["Size", "normal"],
      ["Corner", "bottom-left"],
      ["Theme", "Far Manager"],
      ["GitHub", "a/b"]
    ])
  })

  it("updates the value it shows as soon as it changes", () => {
    const { session } = withHost()
    session.openSettings()
    session.adjustSetting(1)
    expect(session.project().items[0]!.url).toBe("full")
    session.adjustSetting(-1)
    expect(session.project().items[0]!.url).toBe("normal")
  })

  it("cycles the corner through all four and wraps", () => {
    const { session } = withHost()
    session.openSettings()
    session.moveSetting(1)

    const corners: string[] = []
    for (let i = 0; i < 5; i++) {
      corners.push(session.project().items[1]!.url!)
      session.adjustSetting(1)
    }
    expect(corners).toEqual([
      "bottom-left",
      "bottom-right",
      "top-right",
      "top-left",
      "bottom-left"
    ])
  })

  it("hands settings it does not own to the host", () => {
    const { session, changed } = withHost()
    session.openSettings()
    session.moveSetting(2)
    session.adjustSetting(1)
    session.adjustSetting(-1)
    // The session knows nothing about color or chrome.storage.
    expect(changed).toEqual([
      ["theme", 1],
      ["theme", -1]
    ])
  })

  it("announces a notice in its own channel, not the status line", () => {
    const { session } = withHost()
    session.announce("Gruvbox Dark")
    expect(session.project().notice).toBe("Gruvbox Dark")
    expect(session.project().status).toBeNull()

    session.clearNotice()
    expect(session.project().notice).toBeNull()
  })

  it("keeps the notice visible in the settings view", () => {
    // Changing the theme from settings is the main way it is seen.
    const { session } = withHost()
    session.openSettings()
    session.announce("Mono")
    expect(session.project().notice).toBe("Mono")
  })
})

describe("Enter in the settings view", () => {
  function withHost() {
    const changed: [string, number][] = []
    const opened: string[] = []
    const { host } = recordingHost()
    const session = new NavSession(
      {
        ...host,
        hostSettings: () => [
          { key: "github", label: "GitHub", value: "a/b", openable: true }
        ],
        changeSetting: (key, delta) => changed.push([key, delta]),
        openSetting: (key) => opened.push(key)
      },
      storyList()
    )
    session.open()
    session.openSettings()
    return { session, changed, opened }
  }

  it("steps a row that holds values, as it always has", () => {
    // Enter was a synonym for the right arrow here before openable rows
    // existed, and it stays one for every row that has something to step.
    const { session } = withHost()
    expect(session.project().items[0]!.url).toBe("normal")
    session.activateSetting()
    expect(session.project().items[0]!.url).not.toBe("normal")
  })

  it("opens a row that only reports something, and does not step it", () => {
    const { session, opened, changed } = withHost()
    session.moveSetting(2)
    const before = session.project().items.map((i) => i.url)
    session.activateSetting()
    expect(opened).toEqual(["github"])
    expect(changed).toEqual([])
    // Stepping an openable row would be the bug: the value is not a choice.
    expect(session.project().items.map((i) => i.url)).toEqual(before)
  })

  it("does nothing when the host offers no way to open", () => {
    const { host } = recordingHost()
    const session = new NavSession(
      {
        ...host,
        hostSettings: () => [
          { key: "github", label: "GitHub", value: "a/b", openable: true }
        ]
      },
      storyList()
    )
    session.open()
    session.openSettings()
    session.moveSetting(2)
    expect(() => session.activateSetting()).not.toThrow()
  })
})

describe("a divider in the settings view", () => {
  function withHost() {
    const { host } = recordingHost()
    const session = new NavSession(
      {
        ...host,
        hostSettings: () => [
          { key: "gap", label: "", value: "", divider: true },
          { key: "version", label: "Version", value: "0.1.0" }
        ]
      },
      storyList()
    )
    session.open()
    session.openSettings()
    // Size, Corner, [rule], Version
    return session
  }

  const focused = (session: NavSession) =>
    session.project().items[session.project().cursorIndex]!

  it("steps over the rule on the way down", () => {
    const session = withHost()
    session.moveSetting(1) // Corner
    session.moveSetting(1) // would be the rule
    expect(focused(session).name).toBe("Version")
    expect(focused(session).divider).toBeFalsy()
  })

  it("steps over the rule on the way back up", () => {
    const session = withHost()
    session.moveSetting(3) // Version
    expect(focused(session).name).toBe("Version")
    session.moveSetting(-1)
    expect(focused(session).name).toBe("Corner")
  })

  it("never rests on the rule, whatever the step size", () => {
    const session = withHost()
    for (const delta of [1, 1, 1, -1, -1, 2, -2, 5, -5]) {
      session.moveSetting(delta)
      expect(focused(session).divider, `after ${delta}`).toBeFalsy()
    }
  })

  it("draws the rule as a row so the row height stays uniform", () => {
    // rowBudget() in hud.ts divides available height by a constant ROW_HEIGHT.
    // A shorter divider would make the settings list disagree with that.
    const session = withHost()
    const rule = session.project().items.find((i) => i.divider)
    expect(rule, "no divider in the projection").toBeTruthy()
    expect(rule!.name).toBe("")
    expect(rule!.url).toBe("")
  })
})
