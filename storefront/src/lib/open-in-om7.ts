import { ARTISTS, getArtist } from "./artists.ts"

/**
 * A release, opened in OM7Player instead of saved by the browser.
 *
 * A browser download lands in that browser's own downloads, and on a phone
 * that is a place OM7Player cannot see. A link to om7.foundation/open is a
 * universal link: iOS hands it to the app, and the app fetches the release
 * itself, into the folder the listener already chose. The design is
 * OM7-OPEN-LINKS.md in the OM7 repo.
 *
 * The link carries a DOMAIN and a RELEASE ID and nothing else. It never names
 * a file. The app reads this site's discovery document to find the manifest,
 * and finds the file in the manifest, so a link somebody printed cannot make
 * the app fetch an address of their choosing.
 */
export const OM7_OPEN_ENDPOINT = "https://om7.foundation/open"

/** The domain OM7 proved for this site. The app fetches discovery from it. */
export const SITE_DOMAIN = "777records777.studio"

/** Version nibble 1-8 and variant 8/9/a/b, matching the manifest parser. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A plain host: labels, dots, no port, no path, no credentials. */
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

/** A roster handle. The link may name one, and nothing else about the artist. */
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export const openInOm7Href = (
  domain: string,
  releaseId: string,
  handle?: string
): string | null => {
  if (!HOST.test(domain) || !UUID.test(releaseId)) return null
  const artist = handle?.toLowerCase()
  if (artist !== undefined && !HANDLE.test(artist)) return null
  const url = new URL(OM7_OPEN_ENDPOINT)
  url.searchParams.set("d", domain.toLowerCase())
  url.searchParams.set("r", releaseId.toLowerCase())
  if (artist) url.searchParams.set("a", artist)
  return url.toString()
}

/**
 * Every manifest this site will admit to, keyed by the artist who owns it.
 *
 * An older app reads only `manifestUrl` and ignores `a`, so that one key
 * stays, and it stays Dionysus Savior's: his list is the one that already
 * has releases. `manifests` is what a current app uses, so a link can name
 * Viz without the app guessing which list a release lives on.
 */
export const openManifests = (): Record<string, string> =>
  Object.fromEntries(
    ARTISTS.flatMap((artist) =>
      artist.manifestUrl ? [[artist.handle, artist.manifestUrl]] : []
    )
  )

export const legacyOpenManifestUrl = (): string | undefined =>
  getArtist("dionysus-savior")?.manifestUrl

/**
 * The link for one release, or null when the app could not follow it.
 *
 * The handle has to be the artist whose manifest this release came from.
 * The app then asks the site for `manifests[handle]` and nowhere else, so a
 * handle that is not on this roster, or a manifest that is not that
 * artist's, gets no link rather than a link the app would fail.
 */
export const openHrefFor = (
  manifestUrl: string | undefined,
  releaseId: string,
  handle: string
): string | null => {
  if (!manifestUrl || openManifests()[handle] !== manifestUrl) return null
  return openInOm7Href(SITE_DOMAIN, releaseId, handle)
}
