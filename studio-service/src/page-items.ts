import { ARTISTS } from "../../storefront/src/lib/artists.ts"
import { getSoundDownload } from "../../storefront/src/lib/sounds.ts"
import type { StudioDestination } from "./destinations.ts"

/**
 * What is on that page that Site Manager did not put there.
 *
 * The artist page is two sources stacked: the commerce catalogue, whose
 * releases are listed by product id in `artists.ts` and whose files are in
 * `sounds.ts`, and the Site Manager manifest, which is everything published
 * from the phone. The phone's "Sounds on this page" list read the manifest
 * alone and so claimed a page of one song while the page itself showed three.
 * A list that names itself after the page and then omits most of it is worse
 * than no list, because the artist reads the gap as files having vanished.
 *
 * Imported from the storefront's own data rather than restated here. The two
 * checkouts are one repository and these modules are pure data with no
 * imports of their own, so esbuild bundles them into the function the same
 * way it already bundles `backend/src/site-manager/core.ts`. Restating the
 * titles would have put the page's contents in two files that nothing keeps
 * in step, and the first rename would have made this list wrong quietly.
 *
 * These are reported, never removed. The service holds no authority over a
 * commerce product or a hand-placed film - its S3 grant covers its own prefix
 * and nothing else - so each is returned with `removable: false` and the
 * phone offers no control that would fail.
 */
export type PageItem = { id: string; title: string; url: string }

/** A download button's label is the title with an instruction glued to the front. */
const titleFromLabel = (label: string) => label.replace(/^download\s+/i, "").trim()

export const storeItemsFor = (destination: StudioDestination): PageItem[] => {
  const artist = ARTISTS.find((candidate) => candidate.handle === destination.handle)
  if (!artist) return []

  if (destination.section === "movies") {
    return artist.movies.map((movie) => ({ id: movie.url, title: movie.title, url: movie.url }))
  }

  return artist.soundIds.flatMap((productId) => {
    const download = getSoundDownload({ id: productId })
    if (!download) return []
    const title = titleFromLabel(download.label)
    return title ? [{ id: productId, title, url: download.url }] : []
  })
}
