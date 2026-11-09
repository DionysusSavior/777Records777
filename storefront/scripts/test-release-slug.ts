import assert from "node:assert/strict"
import { releaseSlug, releaseSlugs } from "../src/lib/release-slug.ts"

let checks = 0
const check = (name: string, fn: () => void) => {
  fn()
  checks += 1
}

const ARTIST = "Dionysus Savior"

check("the artist's own name does not go in the address twice", () => {
  // The address is going into social posts, so "dionysus-savior-in-time" on a
  // page already at /artists/dionysus-savior is noise a reader has to skip.
  assert.equal(releaseSlug("DIONYSUS SAVIOR - IN TIME", ARTIST), "in-time")
  assert.equal(releaseSlug("Dionysus Savior — Gone Crazy", ARTIST), "gone-crazy")
})

check("a dash that is not the artist's name is left alone", () => {
  assert.equal(releaseSlug("Stop - Start", ARTIST), "stop-start")
  assert.equal(releaseSlug("Viz - In Time", ARTIST), "viz-in-time")
})

check("a release genuinely named after the artist keeps its name", () => {
  // Stripping the prefix here would leave nothing at all.
  assert.equal(releaseSlug("Dionysus Savior", ARTIST), "dionysus-savior")
})

check("punctuation and accents survive as something typeable", () => {
  assert.equal(releaseSlug("Café, Pt. 2!", ARTIST), "cafe-pt-2")
  assert.equal(releaseSlug("  spaced   out  ", ARTIST), "spaced-out")
  assert.equal(releaseSlug("777 / 777", ARTIST), "777-777")
})

check("the earlier release keeps the bare address when two titles collide", () => {
  /*
   A single and the album cut of it share a title. The one already out in the
   world keeps its address; the new arrival carries a piece of its id. The
   other way round would change the address of something people may already
   have posted a link to.
  */
  const slugs = releaseSlugs([
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "In Time", publishedAt: "2026-11-01T00:00:00Z" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "In Time", publishedAt: "2026-10-01T00:00:00Z" },
  ], ARTIST)
  assert.equal(slugs.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "in-time")
  assert.equal(slugs.get("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), "in-time-bbbbbb")
})

check("array order never decides an address", () => {
  // Same two releases, handed over the other way round, and with no dates at
  // all so the id is the only tie-break left.
  const one = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "In Time" }
  const two = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "In Time" }
  const forwards = releaseSlugs([one, two], ARTIST)
  const backwards = releaseSlugs([two, one], ARTIST)
  assert.deepEqual([...forwards.entries()].sort(), [...backwards.entries()].sort())
})

check("a title with no letters at all still gets an address", () => {
  // An ugly address is a smaller failure than no address.
  const slugs = releaseSlugs([{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "!!!" }], ARTIST)
  assert.equal(slugs.get("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), "cccccccc-cccc-4ccc-8ccc-cccccccccccc")
})

check("every release on a page gets exactly one distinct address", () => {
  const releases = [
    { id: "11111111-1111-4111-8111-111111111111", title: "DIONYSUS SAVIOR - IN TIME", publishedAt: "2026-10-14T19:52:50Z" },
    { id: "22222222-2222-4222-8222-222222222222", title: "In Time", publishedAt: "2026-11-01T00:00:00Z" },
    { id: "33333333-3333-4333-8333-333333333333", title: "Gone Crazy", publishedAt: "2026-08-28T00:00:00Z" },
  ]
  const slugs = releaseSlugs(releases, ARTIST)
  assert.equal(slugs.size, releases.length)
  assert.equal(new Set(slugs.values()).size, releases.length)
})

console.log(`Release slug: ${checks} checks passed`)
