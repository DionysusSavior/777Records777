import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  SITE_DOMAIN,
  legacyOpenManifestUrl,
  openHrefFor,
  openInOm7Href,
  openManifests,
} from "../src/lib/open-in-om7.ts"
import { ARTISTS } from "../src/lib/artists.ts"
import { SOUND_PRODUCT_IDS, getSoundDownload } from "../src/lib/sounds.ts"

let checks = 0
const check = (name: string, fn: () => void) => {
  fn()
  checks += 1
}

const RELEASE = "036b3a02-7a65-44d9-9e6f-a5bdc7b820ae"

check("the link is the one the app answers: om7.foundation, /open, d and r", () => {
  // OM7OpenLink.isOpenLink and .parse in the app: host om7.foundation, path
  // exactly /open, a plain host in d and a UUID in r. Anything else and iOS
  // either keeps the tap in the browser or the app calls the link malformed.
  const url = new URL(openInOm7Href(SITE_DOMAIN, RELEASE, "dionysus-savior")!)
  assert.equal(url.origin, "https://om7.foundation")
  assert.equal(url.pathname, "/open")
  assert.deepEqual(Array.from(url.searchParams.keys()), ["d", "r", "a"])
  assert.equal(url.searchParams.get("a"), "dionysus-savior")
  assert.equal(url.searchParams.get("d"), "777records777.studio")
  assert.equal(url.searchParams.get("r"), RELEASE)
})

check("it is lowercased, because the app compares the release id as written", () => {
  const url = new URL(openInOm7Href("777Records777.Studio", RELEASE.toUpperCase())!)
  assert.equal(url.searchParams.get("d"), "777records777.studio")
  assert.equal(url.searchParams.get("r"), RELEASE)
})

check("it names a domain and a release, never a file", () => {
  for (const domain of [
    "https://777records777.studio",
    "777records777.studio/x.om7",
    "777records777.studio:8443",
    "user@777records777.studio",
    "localhost",
    "",
  ]) {
    assert.equal(openInOm7Href(domain, RELEASE), null, domain)
  }
  for (const release of ["", "in-time", "prod_01KJAM74E83E3PEHKTZNSDEGRV", `${RELEASE}.om7`]) {
    assert.equal(openInOm7Href(SITE_DOMAIN, release), null, release)
  }
})

check("discovery names every roster manifest, and the old key stays one artist's", () => {
  const manifests = openManifests()
  for (const artist of ARTISTS) {
    if (!artist.manifestUrl) continue
    assert.equal(manifests[artist.handle], artist.manifestUrl)
    assert.equal(new URL(artist.manifestUrl).protocol, "https:")
  }
  assert.equal(legacyOpenManifestUrl(), manifests["dionysus-savior"])
  assert.equal(manifests["viz"], ARTISTS.find((a) => a.handle === "viz")?.manifestUrl)
})

check("the link names the artist whose manifest the release came from", () => {
  const dion = ARTISTS.find((a) => a.handle === "dionysus-savior")!
  const viz = ARTISTS.find((a) => a.handle === "viz")!
  const dionLink = new URL(openHrefFor(dion.manifestUrl, RELEASE, dion.handle)!)
  const vizLink = new URL(openHrefFor(viz.manifestUrl, RELEASE, viz.handle)!)
  assert.equal(dionLink.searchParams.get("a"), "dionysus-savior")
  assert.equal(vizLink.searchParams.get("a"), "viz")
  assert.equal(openHrefFor(undefined, RELEASE, dion.handle), null)
  assert.equal(openHrefFor(viz.manifestUrl, RELEASE, dion.handle), null)
  assert.equal(openHrefFor(dion.manifestUrl, RELEASE, "not-on-the-roster"), null)
})

check("the discovery document carries the manifest", () => {
  // The route cannot be run here: it imports next/server. What can be held
  // is that it still asks for the manifest and still writes the key.
  const route = readFileSync(
    new URL("../src/app/.well-known/om7-site-manager.json/route.ts", import.meta.url),
    "utf8"
  )
  assert.match(route, /const manifestUrl = legacyOpenManifestUrl\(\)/)
  assert.match(route, /const manifests = openManifests\(\)/)
  assert.match(route, /\.\.\.\(manifestUrl \? \{ manifestUrl \} : \{\}\)/)
  assert.match(route, /\.\.\.\(Object\.keys\(manifests\)\.length \? \{ manifests \} : \{\}\)/)
})

check("every catalogue song has a bundle, and it is a .om7", () => {
  // OM7Player claims the type by filename extension and declares no MIME
  // tag, so the extension is all a phone has to go on.
  for (const id of SOUND_PRODUCT_IDS) {
    const bundle = getSoundDownload({ id })?.om7PlayerUrl
    assert.ok(bundle, `${id} has no bundle`)
    const url = new URL(bundle)
    assert.equal(url.protocol, "https:")
    assert.ok(decodeURIComponent(url.pathname).endsWith(".om7"), bundle)
  }
})

check("the shelf offers a catalogue song's bundle", () => {
  const shelf = readFileSync(
    new URL("../src/modules/artists/components/sound-shelf/index.tsx", import.meta.url),
    "utf8"
  )
  assert.match(shelf, /download\?\.om7PlayerUrl && \(/)
  assert.match(shelf, /<BundlePill href=\{download\.om7PlayerUrl\}/)
})

console.log(`Open in OM7Player: ${checks} checks passed`)
