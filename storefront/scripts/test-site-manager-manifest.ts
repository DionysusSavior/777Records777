import assert from "node:assert/strict"
import { parseSiteManagerManifest } from "../src/lib/site-manager-manifest"

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

const manifest = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  protocol: "om7.site-manager.manifest",
  version: 1,
  updatedAt: "2026-09-01T04:43:57Z",
  items: [validItem],
  ignoredByTheWhitelist: true,
  ...overrides,
})

const parsed = parseSiteManagerManifest(manifest(), manifestUrl)
assert(parsed)
assert.equal(parsed.items.length, 1)
assert.deepEqual(Object.keys(parsed.items[0]), [
  "id", "kind", "title", "url", "contentType", "bytes", "publishedAt",
])

assert.equal(parseSiteManagerManifest(manifest({ version: 2 }), manifestUrl), null)
assert.equal(parseSiteManagerManifest(manifest({ protocol: "some-other-list" }), manifestUrl), null)
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

console.log("Site Manager manifest parser: 8 checks passed")
