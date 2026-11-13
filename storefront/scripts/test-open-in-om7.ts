import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  OPEN_LINK_ARTIST_HANDLE,
  SITE_DOMAIN,
  openHrefFor,
  openInOm7Href,
  openLinkManifestUrl,
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
  const url = new URL(openInOm7Href(SITE_DOMAIN, RELEASE)!)
  assert.equal(url.origin, "https://om7.foundation")
  assert.equal(url.pathname, "/open")
  assert.deepEqual(Array.from(url.searchParams.keys()), ["d", "r"])
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

check("discovery names one manifest, and it is a real artist's own", () => {
  const named = openLinkManifestUrl()
  const artist = ARTISTS.find((a) => a.handle === OPEN_LINK_ARTIST_HANDLE)
  assert.ok(artist, "the artist the open link is filed under is not on the roster")
  assert.equal(named, artist.manifestUrl)
  // The app reads this only when it is https. See OM7SiteHTTP.isSecure.
  assert.equal(new URL(named!).protocol, "https:")
})

check("a release from another manifest gets no link", () => {
  assert.ok(openHrefFor(openLinkManifestUrl(), RELEASE))
  assert.equal(openHrefFor(undefined, RELEASE), null)
  for (const artist of ARTISTS) {
    if (artist.handle === OPEN_LINK_ARTIST_HANDLE || !artist.manifestUrl) continue
    assert.equal(
      openHrefFor(artist.manifestUrl, RELEASE),
      null,
      `${artist.handle} would be offered a link the app cannot follow`
    )
  }
})

check("the discovery document carries the manifest", () => {
  // The route cannot be run here: it imports next/server. What can be held
  // is that it still asks for the manifest and still writes the key.
  const route = readFileSync(
    new URL("../src/app/.well-known/om7-site-manager.json/route.ts", import.meta.url),
    "utf8"
  )
  assert.match(route, /const manifestUrl = openLinkManifestUrl\(\)/)
  assert.match(route, /\.\.\.\(manifestUrl \? \{ manifestUrl \} : \{\}\)/)
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
