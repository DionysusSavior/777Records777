import assert from "node:assert/strict"
import {
  parseSiteManagerManifest,
  shelfEntriesFrom,
} from "../src/lib/site-manager-manifest"

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
  visible: true,
  publishedAt: "2026-09-03T18:00:00Z",
  ignoredByTheWhitelist: true,
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

check("http, foreign origin, kind/type mismatch, bad extension, duplicate ids refused", () => {
  assert.equal(parseSiteManagerManifest(manifest({
    items: [{ ...validItem, url: "http://artist-bucket.example/file.wav" }],
  }), manifestUrl), null)
  assert.equal(parseSiteManagerManifest(manifest({
    items: [{ ...validItem, url: "https://tracker.example/file.wav" }],
  }), manifestUrl), null)
  assert.equal(parseSiteManagerManifest(manifest({
    items: [{ ...validItem, kind: "video" }],
  }), manifestUrl), null)
  assert.equal(parseSiteManagerManifest(manifest({
    items: [{ ...validItem, url: "https://artist-bucket.example/file.svg" }],
  }), manifestUrl), null)
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
    "id", "title", "audio", "reel", "artwork", "bundle", "price", "visible", "publishedAt",
  ])
  assert.equal(parsed.releases![0].price, null)
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

check("price 0, missing price, missing visible, dangling id, wrong role kind all refuse", () => {
  const base = {
    items: [validItem, reelItem, artItem, bundleItem],
  }
  assert.equal(parseSiteManagerManifest(manifest({
    ...base,
    releases: [{ ...validRelease, price: 0 }],
  }), manifestUrl), null)
  const { price: _price, ...noPrice } = validRelease
  assert.equal(parseSiteManagerManifest(manifest({
    ...base,
    releases: [noPrice],
  }), manifestUrl), null)
  const { visible: _visible, ...noVisible } = validRelease
  assert.equal(parseSiteManagerManifest(manifest({
    ...base,
    releases: [noVisible],
  }), manifestUrl), null)
  assert.equal(parseSiteManagerManifest(manifest({
    ...base,
    releases: [{ ...validRelease, audio: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }],
  }), manifestUrl), null)
  assert.equal(parseSiteManagerManifest(manifest({
    ...base,
    releases: [{ ...validRelease, audio: reelItem.id, reel: null, artwork: null, bundle: null }],
  }), manifestUrl), null)
})

check("one item on two releases, a release with no files, svg-as-image, html-as-bundle refused", () => {
  assert.equal(parseSiteManagerManifest(manifest({
    items: [validItem],
    releases: [
      { ...validRelease, id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", reel: null, artwork: null, bundle: null },
      { ...validRelease, id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", reel: null, artwork: null, bundle: null },
    ],
  }), manifestUrl), null)
  assert.equal(parseSiteManagerManifest(manifest({
    items: [validItem],
    releases: [{ ...validRelease, audio: null, reel: null, artwork: null, bundle: null }],
  }), manifestUrl), null)
  assert.equal(parseSiteManagerManifest(manifest({
    items: [{
      ...artItem,
      contentType: "image/svg+xml",
      url: "https://artist-bucket.example/site-manager/dion/c4d2e3f5-6071-490b-bccd-def012345678.svg",
    }],
  }), manifestUrl), null)
  assert.equal(parseSiteManagerManifest(manifest({
    items: [{
      ...bundleItem,
      url: "https://artist-bucket.example/site-manager/dion/d5e3f406-7182-4a0c-bcde-f0123456789a.html",
    }],
  }), manifestUrl), null)
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

console.log(`Site Manager manifest parser: ${checks} checks passed`)
