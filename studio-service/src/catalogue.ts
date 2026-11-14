import { createHash, randomUUID } from "node:crypto"
import type { PublishedObject } from "../../backend/src/site-manager/core.ts"
import { ARTISTS } from "../../storefront/src/lib/artists.ts"
import { parseSiteManagerManifest, shelfEntriesFrom } from "../../storefront/src/lib/site-manager-manifest.ts"
import { releaseSlugs } from "../../storefront/src/lib/release-slug.ts"

const PROTOCOL = "om7.site-manager.manifest"
const VERSION = 1

export class CatalogueError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export type ManifestHead = { body: string; etag: string }

/**
 * Compare-and-swap for one manifest.
 *
 * `ifMatch` null means "create, and fail if it already exists". A writer that
 * replaces the object unconditionally is not this protocol. The phone's direct
 * mode still does that, so a destination must not be written both ways.
 */
export interface ManifestStore {
  read(key: string): Promise<ManifestHead | null>
  write(
    key: string,
    body: string,
    ifMatch: string | null,
  ): Promise<{ etag: string } | { conflict: true }>
}

type ManifestItem = {
  id: string
  kind: "audio" | "video" | "image" | "bundle"
  title: string
  url: string
  contentType: string
  bytes: number
  publishedAt: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The same UUID the website will accept. A looser "36 hex-or-dash characters"
 * let a key through that `parseSiteManagerManifest` then refused, and that
 * refusal blanks the whole page. Version nibble 1-8, variant 8/9/a/b.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const itemId = (key: string) => {
  const file = key.split("/").pop() ?? ""
  const id = file.replace(/\.[^.]+$/, "")
  if (!UUID.test(id)) {
    throw new CatalogueError(500, "catalogue_key", "The stored object key is not a catalogue id.")
  }
  return id.toLowerCase()
}

/**
 * A bundle's item id, derived from its release and NOT equal to it.
 *
 * A bundle's object key is its release - that is what makes a rebuild
 * overwrite instead of orphaning a 70 MB object - and `itemId` reads an id
 * off the key. So the bundle item arrived carrying the release's own id, and
 * the website refuses a manifest where an item id is also a release id
 * (`itemIds.has(release.id)` in the storefront's parser): one id must name
 * one thing. The refusal is the WHOLE manifest, so the first bundle anybody
 * built would have taken that artist's entire Site Manager shelf off their
 * page, films included, with the upload reporting success.
 *
 * Version 5 over a fixed namespace, so it is still derived from the release
 * and still the same on every rebuild - the two properties the deterministic
 * key was for - while being a different UUID from the release's own.
 */
const BUNDLE_NAMESPACE = "7f3e2a10-5c4b-4d8e-9a16-0b2c3d4e5f60"

const bundleItemId = (releaseId: string) => {
  const digest = createHash("sha1")
    .update(Buffer.from(BUNDLE_NAMESPACE.replace(/-/g, ""), "hex"))
    .update(Buffer.from(releaseId.toLowerCase(), "utf8"))
    .digest()
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  const hex = digest.subarray(0, 16).toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Match credited display names to roster handles.
 *
 * The shop shows a release on every page named in `artistHandles`, and it
 * never compares names itself. Applying a credit at once, with no approval
 * step, is safe today only because an admin issues every publishing grant -
 * the day a site has artists who do not know each other, a credit becomes a
 * way onto somebody else's page and this match needs a gate.
 */
const normalizeArtistName = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ")

export const artistHandlesFor = (artists: string[] | undefined): string[] | undefined => {
  if (!artists?.length) return undefined
  const handles: string[] = []
  const seen = new Set<string>()
  for (const name of artists) {
    const want = normalizeArtistName(name)
    const match = ARTISTS.find((artist) => normalizeArtistName(artist.name) === want)
    if (!match || seen.has(match.handle)) continue
    seen.add(match.handle)
    handles.push(match.handle)
  }
  return handles.length ? handles : undefined
}

const kindFor = (published: PublishedObject): ManifestItem["kind"] => {
  if (published.mediaKind === "audio") return "audio"
  if (published.mediaKind === "artwork") return "image"
  if (published.mediaKind === "bundle") return "bundle"
  return "video"
}

/**
 * Add one published object without dropping what is already there.
 *
 * A Sounds publish against a manifest that already exists and has no
 * `releases` array does not invent one. Inventing it would hide every older
 * file, because the website treats a present array as the whole catalogue.
 * A brand new document has no older files, so it starts with an empty
 * `releases` array and the first file becomes a release. A Movies publish
 * writes `movies` and does not add a Sounds row: a loose video is how a
 * film used to show up on the wrong shelf.
 */
export const applyCatalogue = (raw: string | null, published: PublishedObject, publishedAt: string) => {
  let source: Record<string, unknown>
  if (raw === null || raw.trim() === "") {
    source = {
      protocol: PROTOCOL,
      version: VERSION,
      updatedAt: publishedAt,
      items: [],
      releases: [],
    }
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new CatalogueError(409, "catalogue_malformed", "The catalogue could not be read, so it was left unchanged.")
    }
    if (
      !isRecord(parsed) ||
      parsed.protocol !== PROTOCOL ||
      parsed.version !== VERSION ||
      !Array.isArray(parsed.items)
    ) {
      throw new CatalogueError(409, "catalogue_malformed", "The catalogue could not be read, so it was left unchanged.")
    }
    source = parsed
  }

  if (published.section === "movies") {
    const movies = Array.isArray(source.movies) ? source.movies : []
    if (movies.some((movie) => isRecord(movie) && movie.url === published.publicUrl)) {
      return { body: raw ?? JSON.stringify(source), unchanged: true }
    }
    const next = {
      id: itemId(published.key),
      title: published.title,
      url: published.publicUrl,
      poster: "",
      bytes: published.contentLength,
      publishedAt,
    }
    source.movies = [...movies, next]
    source.updatedAt = publishedAt
    return { body: JSON.stringify(source), unchanged: false }
  }

  const items = source.items as unknown[]
  const already = items.findIndex((item) => isRecord(item) && item.url === published.publicUrl)
  if (already >= 0) {
    /*
     A retried completion must not add the same file twice, which is what the
     unchanged answer is for and why it stays for everything else.

     A rebuilt bundle is the one deliberate exception. Its key IS its release,
     so a second upload is meant to arrive at the same URL carrying different
     bytes - artwork added, a reel swapped. Returning unchanged there would
     leave a size and a date describing a file that is no longer in storage.
    */
    if (published.mediaKind !== "bundle") {
      return { body: raw ?? JSON.stringify(source), unchanged: true }
    }
    const prior = items[already] as Record<string, unknown>
    source.items = items.map((item, at) => at !== already ? item : {
      ...prior,
      title: published.title,
      contentType: published.contentType,
      bytes: published.contentLength,
      publishedAt,
    })
    if (Array.isArray(source.releases) && published.releaseId) {
      source.releases = source.releases.map((release) =>
        isRecord(release) && release.id === published.releaseId
          ? { ...release, bundle: prior.id, publishedAt }
          : release)
    }
    source.updatedAt = publishedAt
    return { body: JSON.stringify(source), unchanged: false }
  }

  const item: ManifestItem = {
    id: published.mediaKind === "bundle" && published.releaseId
      ? bundleItemId(published.releaseId)
      : itemId(published.key),
    kind: kindFor(published),
    title: published.title,
    url: published.publicUrl,
    contentType: published.contentType,
    bytes: published.contentLength,
    publishedAt,
  }
  source.items = [...items, item]
  if (Array.isArray(source.releases)) {
    /*
     Named, not defaulted.

     This read "anything that is not a reel, artwork or a bundle is the
     audio", which is true of the only kind that reaches here and would stop
     being true the moment another one did - filing it as the song and
     overwriting the real one. A kind with no role takes no slot; the file is
     still in `items` and still on the page.
    */
    const role = published.mediaKind === "audio" ? "audio"
      : published.mediaKind === "reel" ? "reel"
      : published.mediaKind === "artwork" ? "artwork"
      : published.mediaKind === "bundle" ? "bundle"
      : null
    /*
     Attach, or start one.

     Every completion used to append a release with a single role filled and
     the rest null, because nothing told the service that four uploads were
     one song. A reel published from the phone became its own entry on the
     page, beside the audio it belongs behind, and no player could ever know
     they were the same release.

     The id arrives inside the signed receipt. The signature pins the
     caller's choice; it does not prove they created that release. Anyone
     who can publish to this destination can name an existing release id
     and attach a file to it. An id that matches nothing here starts a
     release under that id rather than a random one, which is what makes
     the order of the four uploads stop mattering.
    */
    const existing = role === null ? -1 : published.releaseId
      ? source.releases.findIndex((r) => isRecord(r) && r.id === published.releaseId)
      : -1
    // `role !== null` is already guaranteed here - `existing` is -1 whenever
    // the role is null, three lines up - but the guarantee travels through a
    // number, so the compiler cannot see it and `[role]` below would be a
    // key of type `string | null`. Stated rather than cast: a cast would
    // have silenced the one check that would notice if that sentinel ever
    // stopped being set.
    const credits = published.artists
    const creditedHandles = artistHandlesFor(credits)
    if (role !== null && existing >= 0) {
      const release = source.releases[existing] as Record<string, unknown>
      source.releases = source.releases.map((r, at) => at !== existing ? r : {
        ...release,
        // The audio is the song, so it names the release even when the reel
        // or the artwork was uploaded first. Anything else keeps the title
        // already there rather than renaming a song after its cover.
        title: role === "audio" ? published.title : release.title,
        // A re-upload of the same role replaces the pointer. The item it
        // replaced stays in `items` and stays downloadable; it is simply no
        // longer part of this release.
        [role]: item.id,
        publishedAt,
        // Credits arrive on every part of the release. Later parts refresh
        // them so adding a name mid-release still lands on the page.
        ...(credits ? { artists: credits, artistHandles: creditedHandles ?? null } : {}),
      })
    } else if (role !== null) {
      source.releases = [
        ...source.releases,
        {
          id: published.releaseId ?? randomUUID(),
          title: published.title,
          audio: role === "audio" ? item.id : null,
          reel: role === "reel" ? item.id : null,
          artwork: role === "artwork" ? item.id : null,
          bundle: role === "bundle" ? item.id : null,
          price: null,
          buyUrl: null,
          visible: true,
          publishedAt,
          ...(credits ? { artists: credits, artistHandles: creditedHandles ?? null } : {}),
        },
      ]
    }
  }
  source.updatedAt = publishedAt
  return { body: JSON.stringify(source), unchanged: false }
}

/**
 * One row of what that page is showing.
 *
 * `removable` is stated by the service rather than worked out by the caller.
 * The phone cannot tell a manifest entry from a commerce product by looking
 * at a title and a URL, and a client that guessed would offer a Remove that
 * the service is bound to refuse.
 */
export type CatalogueEntry = {
  id: string
  title: string
  url: string
  removable: boolean
  /** Where it IS managed, when it is not managed here. */
  managedBy?: string
  /**
   * This release's own page on the website, when the site has one.
   *
   * Stated here rather than built by the phone, for the reason `removable` is.
   * The address is derived from the title by a rule the website also uses, and
   * a Swift copy of that rule would drift - the first time it did, the phone
   * would hand somebody a link to a page that is not there. Absent means the
   * caller should fall back to the page the whole destination points at.
   */
  pageUrl?: string
}

/** What a destination needs to state before a release can have an address. */
export type PageAddress = {
  artistName: string
  /** The destination's own page, e.g. https://site/us/artists/dion */
  artistPageUrl: string
  /** Where the manifest is served from, which the parser needs. */
  manifestUrl: string
}

/**
 * The address of every visible release, keyed by release id.
 *
 * Computed from the PARSED manifest rather than the raw JSON, through the same
 * two functions the website renders with. The slug rule settles collisions
 * across the whole set, so the set has to be identical on both sides - and the
 * parser drops rows the website would refuse. Reading the raw array here would
 * mean a refused row still counted towards a collision, and the phone would
 * state one address while the page served another.
 */
const addressesFor = (raw: string, page: PageAddress): Map<string, string> => {
  const parsed = parseSiteManagerManifest(raw, page.manifestUrl)
  if (!parsed) return new Map()
  const releases = shelfEntriesFrom(parsed).flatMap((entry) =>
    entry.kind === "release" ? [entry.release] : [])
  const base = page.artistPageUrl.replace(/\/+$/, "")
  const slugs = releaseSlugs(releases, page.artistName)
  const addresses = new Map<string, string>()
  for (const [id, slug] of slugs) addresses.set(id, `${base}/${slug}`)
  return addresses
}

const textOf = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null)

const parseCatalogue = (raw: string) => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CatalogueError(409, "catalogue_malformed", "The catalogue could not be read, so it was left unchanged.")
  }
  if (
    !isRecord(parsed) ||
    parsed.protocol !== PROTOCOL ||
    parsed.version !== VERSION ||
    !Array.isArray(parsed.items)
  ) {
    throw new CatalogueError(409, "catalogue_malformed", "The catalogue could not be read, so it was left unchanged.")
  }
  return parsed
}

/** What that destination's page is showing. A missing manifest is an empty page, not an error. */
export const listCatalogue = (
  raw: string | null,
  section: "sounds" | "movies",
  page?: PageAddress,
): CatalogueEntry[] => {
  if (raw === null || raw.trim() === "") return []
  const source = parseCatalogue(raw)
  if (section === "movies") {
    if (!Array.isArray(source.movies)) return []
    return source.movies.flatMap((movie) => {
      if (!isRecord(movie)) return []
      const url = textOf(movie.url)
      const title = textOf(movie.title)
      const id = textOf(movie.id)
      return url && title && id ? [{ id, title, url, removable: true }] : []
    })
  }
  const items = (source.items as unknown[]).filter(isRecord)
  if (Array.isArray(source.releases)) {
    // Movies have no page of their own on the website, so no address is
    // offered for them rather than one that would 404.
    const addresses = page && section === "sounds" ? addressesFor(raw, page) : new Map<string, string>()
    return source.releases.flatMap((release) => {
      if (!isRecord(release) || release.visible === false) return []
      const audioId = textOf(release.audio)
      let url: string | null = null
      if (audioId) {
        const audio = items.find((item) => item.id === audioId && item.kind === "audio")
        url = audio ? textOf(audio.url) : null
      } else {
        // A photo with a price and nothing to play. Listing only the audio
        // made that release invisible, so the phone could neither show it
        // nor remove it.
        const artworkId = textOf(release.artwork)
        const artwork = artworkId
          ? items.find((item) => item.id === artworkId && item.kind === "image")
          : undefined
        url = artwork ? textOf(artwork.url) : null
      }
      const title = textOf(release.title)
      const id = textOf(release.id)
      if (!url || !title || !id) return []
      const pageUrl = addresses.get(id)
      return [pageUrl ? { id, title, url, removable: true, pageUrl } : { id, title, url, removable: true }]
    })
  }
  return items.flatMap((item) => {
    if (item.kind !== "audio") return []
    const url = textOf(item.url)
    const title = textOf(item.title)
    const id = textOf(item.id)
    return url && title && id ? [{ id, title, url, removable: true }] : []
  })
}

/**
 * Everything that page is showing, in the order the page shows it.
 *
 * The manifest first, because that is what this service published and what it
 * can take back. Then whatever else stands on the page, reported so the
 * artist sees their whole shelf and marked so no control is offered that
 * would fail.
 *
 * A declared item whose URL is already in the manifest is dropped rather than
 * listed twice. The page itself de-duplicates by URL when it merges published
 * films into the static ones, so doing anything else here would show a row
 * that does not exist on the page.
 */
export const pageCatalogue = (
  raw: string | null,
  section: "sounds" | "movies",
  storeItems: readonly { id: string; title: string; url: string }[],
  managedBy: string,
  page?: PageAddress,
): CatalogueEntry[] => {
  const published = listCatalogue(raw, section, page)
  const seen = new Set(published.map((entry) => entry.url))
  const rest = storeItems.flatMap((item) =>
    seen.has(item.url) ? [] : [{ ...item, removable: false, managedBy }])
  return [...published, ...rest]
}

/** Every file a release points at, named once so nothing is swept by half. */
const partsOf = (release: Record<string, unknown>): string[] =>
  [release.audio, release.reel, release.artwork, release.bundle]
    .filter((id): id is string => typeof id === "string")

/**
 * Take one published URL off the page. Does not invent a `releases` array.
 * A Sounds removal also drops any release that used that file, AND the other
 * files that release was the only thing holding on to. A Movies removal never
 * touches Sounds.
 *
 * WHY THE REST OF THE RELEASE GOES TOO. A release is a song with its reel,
 * its artwork and its downloadable bundle. Removing it used to drop the
 * release and the one named file, leaving the other three in `items` - where
 * nothing can reach them, because `listCatalogue` lists RELEASES for sounds,
 * not items. The phone showed no row, the page showed no row, and the bytes
 * stayed in the artist's bucket for good. One publish-then-remove of a song
 * with a bundle left 213 KB behind on 9 November 2026, which is how this was
 * found. For a product whose whole claim is that the files are the artist's
 * and under their control, a file they cannot see or delete is the wrong kind
 * of permanent.
 *
 * SHARED FILES ARE NOT STRANDED. One artwork used by two releases survives
 * the removal of either, because `stillUsed` is computed from the releases
 * that remain. Only what nothing else points at is taken.
 *
 * ITEMS NO RELEASE EVER NAMED ARE LEFT ALONE. They may be orphans from an
 * older failure, but they are not THIS removal's to judge, and sweeping files
 * nobody asked about is how a delete becomes something to fear.
 *
 * The URLs come back rather than being deleted here, because this function
 * only ever rewrites a document. The caller holds the S3 grant and has
 * already proved that each key sits inside its own prefix.
 */
export const removeFromCatalogue = (
  raw: string,
  target: { url: string; section: "sounds" | "movies" },
  updatedAt: string,
): { body: string; orphaned: string[] } => {
  const source = parseCatalogue(raw)
  if (target.section === "movies") {
    const movies = Array.isArray(source.movies) ? source.movies.filter(isRecord) : []
    const next = movies.filter((movie) => movie.url !== target.url)
    if (next.length === movies.length) {
      throw new CatalogueError(404, "not_found", "That file is not on this page.")
    }
    source.movies = next
    source.updatedAt = updatedAt
    return { body: JSON.stringify(source), orphaned: [] }
  }
  const items = (source.items as unknown[]).filter(isRecord)
  const removed = items.filter((item) => item.url === target.url)
  if (removed.length === 0) {
    throw new CatalogueError(404, "not_found", "That file is not on this page.")
  }
  const removedIds = new Set(removed.map((item) => item.id))
  let kept = items.filter((item) => item.url !== target.url)
  const orphaned: string[] = []

  if (Array.isArray(source.releases)) {
    const releases = source.releases.filter(isRecord)
    const surviving = releases.filter((release) => !partsOf(release).some((id) => removedIds.has(id)))
    const dropped = releases.filter((release) => partsOf(release).some((id) => removedIds.has(id)))
    const stillUsed = new Set(surviving.flatMap(partsOf))
    const stranded = new Set(
      dropped.flatMap(partsOf).filter((id) => !removedIds.has(id) && !stillUsed.has(id)),
    )
    source.releases = surviving
    kept = kept.filter((item) => {
      const id = textOf(item.id)
      if (id === null || !stranded.has(id)) return true
      const url = textOf(item.url)
      if (url !== null) orphaned.push(url)
      return false
    })
  }

  source.items = kept
  source.updatedAt = updatedAt
  return { body: JSON.stringify(source), orphaned }
}

/**
 * Where one manifest lives, as the writer and the website each see it.
 *
 * Two strings that would be easy to transpose, so they travel together.
 * `key` is what the compare-and-swap runs against. `url` is where the website
 * fetches it from, and the parser needs it: it refuses any media URL that is
 * not on the manifest's own origin, so the check below cannot be made with
 * the key alone.
 */
export type ManifestLocation = {
  key: string
  url: string
}

/**
 * Refuse to be the write that empties the page.
 *
 * The storefront's parser answers null for the WHOLE document over one
 * unreadable row, and the page then falls back to its static content with
 * HTTP 200. So one bad row does not look like a bad row - it looks like every
 * release the artist ever published has been deleted, with nothing failing
 * anywhere. The four faults found on 7 November 2026 all had that shape, and
 * the dearest of them - six content types this service accepted and the
 * website did not - survived because neither side ever asked the other.
 *
 * After those fixes the writer's output is a verified subset of what the
 * parser accepts; `every publishable media type survives the website's
 * parser` is what proves it. This is the backstop for the NEXT drift, because
 * the two tables live in different packages and will be edited apart again.
 *
 * It runs on the body about to be written rather than on the request, because
 * what the request carries is not what the manifest ends up saying.
 *
 * The exception is the point of it, not a hole in it. A manifest the parser
 * already refuses is not made worse by another write, and refusing one would
 * be a trap: the artist could never publish OR remove anything on that page
 * again, which is precisely when they need to most. So this blocks only a
 * write that would turn a readable page into an unreadable one.
 */
const refuseUnreadable = (manifest: ManifestLocation, prior: string | null, next: string) => {
  if (parseSiteManagerManifest(next, manifest.url, "store")) return
  const had = prior !== null && prior.trim() !== ""
  if (had && !parseSiteManagerManifest(prior, manifest.url, "store")) return
  throw new CatalogueError(
    500,
    "catalogue_unreadable",
    "The page was left as it was, because this change would have hidden everything on it.",
  )
}

const MAX_PRICE_CENTS = 1_000_000_000
const MAX_BUY_URL_CHARS = 500

const httpsBuyUrl = (value: string): boolean => {
  if (value.length === 0 || value.length > MAX_BUY_URL_CHARS) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.host !== ""
}

/**
 * Set or clear the price on a release that already exists.
 *
 * Not an upload. A price carried inside a receipt would be applied whenever
 * that receipt completed, including hours later, and would overwrite a newer
 * price. This write uses the manifest's current etag, and a file completion
 * spreads the release it read, so it keeps a price it did not set.
 *
 * A missing key leaves the stored value. Null clears it. A price and a link
 * stay paired: both set, or both empty.
 */
export const applySale = (
  raw: string,
  releaseId: string,
  patch: { price?: number | null; buyUrl?: string | null },
  present: { price: boolean; buyUrl: boolean },
  updatedAt: string,
) => {
  const source = parseCatalogue(raw)
  if (!Array.isArray(source.releases)) {
    throw new CatalogueError(404, "not_found", "That release is not on this page.")
  }
  const index = source.releases.findIndex((release) => isRecord(release) && release.id === releaseId)
  if (index < 0) throw new CatalogueError(404, "not_found", "That release is not on this page.")
  const release = { ...(source.releases[index] as Record<string, unknown>) }
  const storedPrice = release.price === null || typeof release.price === "number" ? release.price : null
  const storedBuy = release.buyUrl === null || typeof release.buyUrl === "string" ? release.buyUrl : null
  const price = present.price ? patch.price ?? null : storedPrice
  const buyUrl = present.buyUrl ? patch.buyUrl ?? null : storedBuy
  if (price !== null && (!Number.isSafeInteger(price) || price < 1 || price > MAX_PRICE_CENTS)) {
    throw new CatalogueError(400, "invalid_request", "Name a price in cents, or clear it.")
  }
  if (buyUrl !== null && !httpsBuyUrl(buyUrl)) {
    throw new CatalogueError(400, "invalid_request", "The buy link has to be https, with no name or password in it.")
  }
  if ((price === null) !== (buyUrl === null)) {
    throw new CatalogueError(400, "invalid_request", "A price and a buy link travel together, or not at all.")
  }
  if (price === storedPrice && buyUrl === storedBuy) {
    return { body: raw, unchanged: true }
  }
  release.price = price
  release.buyUrl = buyUrl
  source.releases = source.releases.map((item, at) => at === index ? release : item)
  source.updatedAt = updatedAt
  return { body: JSON.stringify(source), unchanged: false }
}

export const commitSale = async (
  store: ManifestStore,
  manifest: ManifestLocation,
  releaseId: string,
  patch: { price?: number | null; buyUrl?: string | null },
  present: { price: boolean; buyUrl: boolean },
  updatedAt: string,
) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.read(manifest.key)
    if (!current) throw new CatalogueError(404, "not_found", "That release is not on this page.")
    const next = applySale(current.body, releaseId, patch, present, updatedAt)
    if (next.unchanged) return
    refuseUnreadable(manifest, current.body, next.body)
    const written = await store.write(manifest.key, next.body, current.etag)
    if ("etag" in written) return
  }
  throw new CatalogueError(409, "catalogue_conflict", "The page changed while that price was being saved. Try again.")
}

export const commitRemoval = async (
  store: ManifestStore,
  manifest: ManifestLocation,
  target: { url: string; section: "sounds" | "movies" },
  updatedAt: string,
) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.read(manifest.key)
    if (!current) throw new CatalogueError(404, "not_found", "That file is not on this page.")
    const { body, orphaned } = removeFromCatalogue(current.body, target, updatedAt)
    refuseUnreadable(manifest, current.body, body)
    const written = await store.write(manifest.key, body, current.etag)
    if ("etag" in written) return orphaned
  }
  throw new CatalogueError(409, "catalogue_conflict", "The page changed while that file was being removed. Try again.")
}

export const commitCatalogue = async (
  store: ManifestStore,
  manifest: ManifestLocation,
  published: PublishedObject,
  publishedAt: string,
) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.read(manifest.key)
    const next = applyCatalogue(current?.body ?? null, published, publishedAt)
    if (next.unchanged) return
    // Checked inside the loop, because a conflict recomputes the body
    // from whatever the manifest says now.
    refuseUnreadable(manifest, current?.body ?? null, next.body)
    const written = await store.write(manifest.key, next.body, current?.etag ?? null)
    if ("etag" in written) return
  }
  throw new CatalogueError(409, "catalogue_conflict", "The catalogue changed while this file was being added. Retry completion; the file is already stored.")
}
