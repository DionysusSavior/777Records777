import { getArtist } from "./artists.ts"

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

export const openInOm7Href = (domain: string, releaseId: string): string | null => {
  if (!HOST.test(domain) || !UUID.test(releaseId)) return null
  const url = new URL(OM7_OPEN_ENDPOINT)
  url.searchParams.set("d", domain.toLowerCase())
  url.searchParams.set("r", releaseId.toLowerCase())
  return url.toString()
}

/**
 * The one manifest this site's discovery document names.
 *
 * The protocol names ONE manifest per domain, which fits a site that belongs
 * to one artist and does not fit a label. This site has two artists and two
 * manifests, and on 12 November 2026 only this one exists: Viz has published
 * nothing through Site Manager. Naming it here rather than picking "the
 * first artist with a manifest" keeps the choice visible, because the day Viz
 * publishes, their releases will NOT be reachable through the link and this
 * is the line that says why. That is a protocol question, queued in the OM7
 * repo, and not something to paper over here.
 */
export const OPEN_LINK_ARTIST_HANDLE = "dionysus-savior"

export const openLinkManifestUrl = (): string | undefined =>
  getArtist(OPEN_LINK_ARTIST_HANDLE)?.manifestUrl

/**
 * The link for one release, or null when the app could not follow it.
 *
 * A release from any other manifest gets no link. The app would open,
 * read the manifest discovery names, not find the release there, and say
 * "That release is no longer on the site" about a release that plainly is.
 */
export const openHrefFor = (
  manifestUrl: string | undefined,
  releaseId: string
): string | null =>
  manifestUrl && manifestUrl === openLinkManifestUrl()
    ? openInOm7Href(SITE_DOMAIN, releaseId)
    : null
