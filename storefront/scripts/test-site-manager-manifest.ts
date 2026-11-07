import assert from "node:assert/strict"
import {
  parseSiteManagerManifest,
  shelfEntriesFrom,
} from "../src/lib/site-manager-manifest.ts"

const manifestUrl = "https://artist-bucket.example/site-manager/dion/index.json"
const validItem = {
  id: "8efa1310-4fbe-45c8-bfbe-a681f7316f50",
  kind: "audio",
  title: "New Deal",
  url: "https://artist-bucket.example/site-manager/dion/8efa1310-4fbe-45c8-bfbe-a681f7316f50.wav",
  contentType: "audio/wav",
  bytes: 46_012_586,
  publishedAt: "2026-09-01T04:43:57Z",
  ignoredByTheWhitelist: "not returned",
}

const reelItem = {
  id: "b3c1d2e4-5f67-489a-abbc-cdef01234567",
  kind: "video",
  title: "In Time reel",
  url: "https://artist-bucket.example/site-manager/dion/b3c1d2e4-5f67-489a-abbc-cdef01234567.mp4",
  contentType: "video/mp4",
  bytes: 4_000_000,
  publishedAt: "2026-09-03T18:00:00Z",
}

const artItem = {
  id: "c4d2e3f5-6071-490b-bccd-def012345678",
  kind: "image",
  title: "In Time cover",
  url: "https://artist-bucket.example/site-manager/dion/c4d2e3f5-6071-490b-bccd-def012345678.jpg",
  contentType: "image/jpeg",
  bytes: 220_000,
  publishedAt: "2026-09-03T18:00:00Z",
}

const bundleItem = {
  id: "d5e3f406-7182-4a0c-bcde-f0123456789a",
  kind: "bundle",
  title: "In Time bundle",
  url: "https://artist-bucket.example/site-manager/dion/d5e3f406-7182-4a0c-bcde-f0123456789a.om7",
  contentType: "application/octet-stream",
  bytes: 50_000_000,
  publishedAt: "2026-09-03T18:00:00Z",
}

const validRelease = {
  id: "a1b2c3d4-e5f6-4789-8abc-def012345678",
  title: "In Time",
  audio: validItem.id,
  reel: reelItem.id,
  artwork: artItem.id,
  bundle: bundleItem.id,
  price: null,
  buyUrl: null,
  visible: true,
  publishedAt: "2026-09-03T18:00:00Z",
  ignoredByTheWhitelist: true,
}

const pricedRelease = {
  ...validRelease,
  id: "e6f7a8b9-c0d1-4e2f-9a3b-4c5d6e7f8091",
  price: 999,
  buyUrl: "https://buy.stripe.com/test_abc123",
}

const manifest = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  protocol: "om7.site-manager.manifest",
  version: 1,
  updatedAt: "2026-09-01T04:43:57Z",
  items: [validItem],
  ignoredByTheWhitelist: true,
  ...overrides,
})

let checks = 0
const check = (name: string, fn: () => void) => {
  fn()
  checks += 1
}

check("Stage 1 items still parse and extra fields are dropped", () => {
  const parsed = parseSiteManagerManifest(manifest(), manifestUrl)
  assert(parsed)
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.releases, undefined)
  assert.deepEqual(Object.keys(parsed.items[0]), [
    "id", "kind", "title", "url", "contentType", "bytes", "publishedAt",
  ])
})

check("unknown protocol or version is refused", () => {
  assert.equal(parseSiteManagerManifest(manifest({ version: 2 }), manifestUrl), null)
  assert.equal(parseSiteManagerManifest(manifest({ protocol: "some-other-list" }), manifestUrl), null)
})

check("a bad item is dropped, and a duplicate id still refuses the page", () => {
  for (const bad of [
    { ...validItem, url: "http://artist-bucket.example/file.wav" },
    { ...validItem, url: "https://tracker.example/file.wav" },
    { ...validItem, kind: "video" },
    { ...validItem, url: "https://artist-bucket.example/file.svg" },
  ]) {
    const parsed = parseSiteManagerManifest(manifest({
      items: [reelItem, bad],
    }), manifestUrl)
    assert(parsed)
    assert.deepEqual(parsed.items.map((item) => item.id), [reelItem.id])
  }
  assert.equal(parseSiteManagerManifest(manifest({
    items: [validItem, validItem],
  }), manifestUrl), null)
})

const stage2 = manifest({
  items: [validItem, reelItem, artItem, bundleItem],
  releases: [validRelease],
})

check("a stated release keeps every role and drops extra fields", () => {
  const parsed = parseSiteManagerManifest(stage2, manifestUrl)
  assert(parsed)
  assert.equal(parsed.releases?.length, 1)
  assert.deepEqual(Object.keys(parsed.releases![0]), [
    "id", "title", "audio", "reel", "artwork", "bundle", "price", "buyUrl", "visible", "publishedAt",
  ])
  assert.equal(parsed.releases![0].price, null)
  assert.equal(parsed.releases![0].buyUrl, null)
  assert.equal(parsed.releases![0].visible, true)
})

check("empty releases[] is present, not inferred from items", () => {
  const parsed = parseSiteManagerManifest(manifest({ releases: [] }), manifestUrl)
  assert(parsed)
  assert.deepEqual(parsed.releases, [])
  assert.equal(parsed.items.length, 1)
})

check("hidden stays in the model so the shelf can honour visible: false", () => {
  const parsed = parseSiteManagerManifest(manifest({
    items: [validItem],
    releases: [{ ...validRelease, reel: null, artwork: null, bundle: null, visible: false }],
  }), manifestUrl)
  assert.equal(parsed?.releases?.[0].visible, false)
})

check("a bad release is dropped and the one beside it stays", () => {
  const base = {
    items: [validItem, reelItem, artItem, bundleItem],
  }
  const good = { ...pricedRelease }
  const cases = [
    { ...validRelease, price: 0 },
    (({ price: _price, ...rest }) => rest)(validRelease),
    (({ visible: _visible, ...rest }) => rest)(validRelease),
    { ...validRelease, audio: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
    { ...validRelease, audio: reelItem.id, reel: null, artwork: null, bundle: null },
  ]
  for (const bad of cases) {
    const parsed = parseSiteManagerManifest(manifest({
      ...base,
      releases: [bad, good],
    }), manifestUrl)
    assert(parsed)
    assert.deepEqual(parsed.releases?.map((release) => release.id), [good.id])
  }
})

check("one item on two releases still refuses; an empty release and a bad file are dropped", () => {
  assert.equal(parseSiteManagerManifest(manifest({
    items: [validItem],
    releases: [
      { ...validRelease, id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", reel: null, artwork: null, bundle: null },
      { ...validRelease, id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", reel: null, artwork: null, bundle: null },
    ],
  }), manifestUrl), null)
  const emptyRelease = parseSiteManagerManifest(manifest({
    items: [validItem],
    releases: [{ ...validRelease, audio: null, reel: null, artwork: null, bundle: null }],
  }), manifestUrl)
  assert(emptyRelease)
  assert.equal(emptyRelease.releases?.length, 0)
  const svg = parseSiteManagerManifest(manifest({
    items: [{
      ...artItem,
      contentType: "image/svg+xml",
      url: "https://artist-bucket.example/site-manager/dion/c4d2e3f5-6071-490b-bccd-def012345678.svg",
    }, validItem],
  }), manifestUrl)
  assert(svg)
  assert.deepEqual(svg.items.map((item) => item.id), [validItem.id])
  const html = parseSiteManagerManifest(manifest({
    items: [{
      ...bundleItem,
      url: "https://artist-bucket.example/site-manager/dion/d5e3f406-7182-4a0c-bcde-f0123456789a.html",
    }],
  }), manifestUrl)
  assert(html)
  assert.equal(html.items.length, 0)
})

check("a priced release keeps its price and its buy link together", () => {
  const parsed = parseSiteManagerManifest(manifest({
    items: [validItem, reelItem, artItem, bundleItem],
    releases: [pricedRelease],
  }), manifestUrl)
  assert(parsed)
  assert.equal(parsed.releases?.[0].price, 999)
  assert.equal(parsed.releases?.[0].buyUrl, "https://buy.stripe.com/test_abc123")
})

check("a release with a broken price is dropped, and the writer still refuses it", () => {
  const base = { items: [validItem, reelItem, artItem, bundleItem] }
  const broken = [
    { ...validRelease, price: 999 },
    { ...validRelease, buyUrl: "https://buy.stripe.com/test_abc123" },
    { ...pricedRelease, buyUrl: "http://buy.stripe.com/test_abc123" },
    (({ buyUrl: _buyUrl, ...rest }) => rest)(pricedRelease),
  ]
  for (const bad of broken) {
    const shown = parseSiteManagerManifest(manifest({
      ...base,
      releases: [bad, pricedRelease],
    }), manifestUrl)
    assert(shown)
    assert.deepEqual(shown.releases?.map((release) => release.id), [pricedRelease.id])
    assert.equal(parseSiteManagerManifest(manifest({
      ...base,
      releases: [bad],
    }), manifestUrl, "store"), null)
  }
})

check("the shelf hides invisible releases and does not invent them from items", () => {
  const stage1 = parseSiteManagerManifest(manifest(), manifestUrl)!
  assert.equal(shelfEntriesFrom(stage1).length, 1)
  assert.equal(shelfEntriesFrom(stage1)[0].kind, "item")

  const hidden = parseSiteManagerManifest(manifest({
    items: [validItem],
    releases: [{ ...validRelease, reel: null, artwork: null, bundle: null, visible: false }],
  }), manifestUrl)!
  assert.deepEqual(shelfEntriesFrom(hidden), [])

  const empty = parseSiteManagerManifest(manifest({ releases: [] }), manifestUrl)!
  assert.deepEqual(shelfEntriesFrom(empty), [])
})

check("a movie is a movie, and a missing movies list leaves the sounds alone", () => {
  const film = {
    id: "e6f40517-8293-4b1d-8def-0123456789ab",
    title: "Time Machine",
    url: "https://artist-bucket.example/site-manager/viz/e6f40517-8293-4b1d-8def-0123456789ab.mp4",
    poster: "",
    bytes: 20_000_000,
    publishedAt: "2026-10-25T12:00:00.000Z",
  }
  const parsed = parseSiteManagerManifest(manifest({ movies: [film] }), manifestUrl)
  assert(parsed)
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.movies?.length, 1)
  assert.equal(parsed.movies?.[0].poster, "")
  assert.equal(shelfEntriesFrom(parsed).length, 1)

  const offSite = parseSiteManagerManifest(manifest({
    movies: [{ ...film, url: "https://evil.example/film.mp4" }],
  }), manifestUrl)
  assert(offSite)
  assert.equal(offSite.movies?.length, 0)
  assert.equal(offSite.items.length, 1)
  assert.equal(parseSiteManagerManifest(manifest({
    movies: [{ ...film, url: "https://evil.example/film.mp4" }],
  }), manifestUrl, "store"), null)
})

console.log(`Site Manager manifest parser: ${checks} checks passed`)
