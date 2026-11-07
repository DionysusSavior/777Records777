const PROTOCOL = "om7.site-manager.manifest"
const VERSION = 1
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_ITEMS = 500
const MAX_RELEASES = 500
const MAX_MEDIA_BYTES = 5 * 1024 * 1024 * 1024
const MAX_PRICE_CENTS = 1_000_000_000
const MAX_BUY_URL_CHARS = 500

type MediaRule = {
  kind: "audio" | "video" | "image" | "bundle"
  extensions: string[]
}

const MEDIA_RULES: Record<string, MediaRule> = {
  // aac, flac and webm are here because the publishing service accepts them
  // and this parser did not, which is not a safe way to disagree: an item it
  // cannot read refuses the whole manifest, so one FLAC emptied the shelf
  // rather than being left off it. The service folds its x- aliases to the
  // spellings below; see CONTENT_TYPES in backend/src/site-manager/core.ts.
  "audio/aac": { kind: "audio", extensions: [".aac"] },
  "audio/aiff": { kind: "audio", extensions: [".aif", ".aiff"] },
  "audio/flac": { kind: "audio", extensions: [".flac"] },
  "audio/mp4": { kind: "audio", extensions: [".m4a"] },
  "audio/mpeg": { kind: "audio", extensions: [".mp3"] },
  "audio/wav": { kind: "audio", extensions: [".wav"] },
  "video/mp4": { kind: "video", extensions: [".mp4"] },
  "video/quicktime": { kind: "video", extensions: [".mov"] },
  "video/webm": { kind: "video", extensions: [".webm"] },
  "image/jpeg": { kind: "image", extensions: [".jpg", ".jpeg"] },
  "image/png": { kind: "image", extensions: [".png"] },
  "image/webp": { kind: "image", extensions: [".webp"] },
  // The extension is the only thing OM7Player matches on; a MIME of our own
  // would claim a type no server sends. octet-stream plus .om7 is how these
  // already live on this bucket: they download rather than render.
  "application/octet-stream": { kind: "bundle", extensions: [".om7"] },
}

const RELEASE_ROLES = {
  audio: "audio",
  reel: "video",
  artwork: "image",
  bundle: "bundle",
} as const

type ReleaseRole = keyof typeof RELEASE_ROLES

export type SiteManagerManifestItem = {
  id: string
  kind: MediaRule["kind"]
  title: string
  url: string
  contentType: string
  bytes: number
  publishedAt: string
}

export type SiteManagerManifestRelease = {
  id: string
  title: string
  audio: string | null
  reel: string | null
  artwork: string | null
  bundle: string | null
  price: number | null
  /**
   * The artist's own Stripe Payment Link (or any hosted checkout), in cents
   * against `price`. Present if and only if `price` is non-null - a priced
   * release with no way to pay for it, or a link with no stated price, are
   * both rejected by parseRelease rather than rendered half-formed.
   */
  buyUrl: string | null
  visible: boolean
  publishedAt: string
}

export type SiteManagerMovie = {
  id: string
  title: string
  url: string
  poster: string
  bytes: number
  publishedAt: string
}

export type SiteManagerManifest = {
  protocol: typeof PROTOCOL
  version: typeof VERSION
  updatedAt: string
  items: SiteManagerManifestItem[]
  /**
   * Absent on Stage 1 manifests. Present (even empty) means the publisher
   * has taken on the release model: the shelf must not invent rows from
   * leftover files.
   */
  releases?: SiteManagerManifestRelease[]
  /**
   * Films published to the Movies destination. Absent means there are none
   * from this manifest; the static films in artists.ts are a different list
   * and are not deleted when this is missing or the fetch fails.
   */
  movies?: SiteManagerMovie[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isISOInstant = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value))

const isUUID = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )

const parseItem = (
  value: unknown,
  manifestOrigin: string
): SiteManagerManifestItem | null => {
  if (!isRecord(value) || !isUUID(value.id)) return null

  const contentType =
    typeof value.contentType === "string" ? value.contentType.toLowerCase() : ""
  const rule = MEDIA_RULES[contentType]
  if (!rule || value.kind !== rule.kind) return null

  const title = typeof value.title === "string" ? value.title.trim() : ""
  if (!title || title.length > 160) return null

  if (
    typeof value.bytes !== "number" ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > MAX_MEDIA_BYTES ||
    !isISOInstant(value.publishedAt)
  ) {
    return null
  }

  if (typeof value.url !== "string" || value.url.length > 1_000) return null
  let mediaUrl: URL
  try {
    mediaUrl = new URL(value.url)
  } catch {
    return null
  }

  // A compromised manifest credential must not turn the artist page into a
  // beacon for an unrelated host. For direct mode the manifest and its media
  // deliberately share one public origin; a future CDN should serve both.
  if (
    mediaUrl.protocol !== "https:" ||
    mediaUrl.username ||
    mediaUrl.password ||
    mediaUrl.origin !== manifestOrigin ||
    !rule.extensions.some((extension) =>
      mediaUrl.pathname.toLowerCase().endsWith(extension)
    )
  ) {
    return null
  }

  return {
    id: value.id.toLowerCase(),
    kind: rule.kind,
    title,
    url: mediaUrl.toString(),
    contentType,
    bytes: value.bytes,
    publishedAt: value.publishedAt,
  }
}

const parseRoleId = (value: unknown): string | null | undefined => {
  if (value === null) return null
  if (!isUUID(value)) return undefined
  return value.toLowerCase()
}

const parsePrice = (value: unknown): number | null | undefined => {
  if (value === null) return null
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_PRICE_CENTS
  ) {
    return value
  }
  return undefined
}

/**
 * An external checkout link, https-only with no origin pinning.
 *
 * Unlike parseItem's media URLs above, this is deliberately NOT required to
 * share the manifest's own origin - a Stripe Payment Link lives on
 * buy.stripe.com or the artist's own checkout domain, never on the bucket
 * serving the manifest. The precedent is introDownloadUrl in
 * music-metaverse/infra/lambda/directory/validate.mjs: an artist's own
 * external link, https-only, no host restriction, because OM7 does not run
 * or control the destination.
 */
const parseBuyUrl = (value: unknown): string | null | undefined => {
  if (value === null) return null
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_BUY_URL_CHARS) {
    return undefined
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.host) {
    return undefined
  }
  return value
}

const parseRelease = (
  value: unknown,
  itemsById: Map<string, SiteManagerManifestItem>
): SiteManagerManifestRelease | null => {
  if (!isRecord(value) || !isUUID(value.id)) return null

  const title = typeof value.title === "string" ? value.title.trim() : ""
  if (!title || title.length > 160) return null
  if (typeof value.visible !== "boolean" || !isISOInstant(value.publishedAt)) {
    return null
  }
  if (!("price" in value)) return null
  const price = parsePrice(value.price)
  if (price === undefined) return null

  if (!("buyUrl" in value)) return null
  const buyUrl = parseBuyUrl(value.buyUrl)
  if (buyUrl === undefined) return null
  // Paired, never one without the other - a price with nothing to pay it at,
  // or a link with no stated price, is a broken catalogue entry, not a
  // partial one. Rejecting the whole release is this file's convention for
  // every other malformed field; this is no exception.
  if ((price === null) !== (buyUrl === null)) return null

  const roles: Record<ReleaseRole, string | null> = {
    audio: null,
    reel: null,
    artwork: null,
    bundle: null,
  }
  const used = new Set<string>()
  let attached = 0
  for (const role of Object.keys(RELEASE_ROLES) as ReleaseRole[]) {
    if (!(role in value)) return null
    const id = parseRoleId(value[role])
    if (id === undefined) return null
    if (id === null) {
      roles[role] = null
      continue
    }
    const item = itemsById.get(id)
    if (!item || item.kind !== RELEASE_ROLES[role] || used.has(id)) return null
    used.add(id)
    roles[role] = id
    attached += 1
  }
  if (attached < 1) return null

  return {
    id: value.id.toLowerCase(),
    title,
    audio: roles.audio,
    reel: roles.reel,
    artwork: roles.artwork,
    bundle: roles.bundle,
    price,
    buyUrl,
    visible: value.visible,
    publishedAt: value.publishedAt,
  }
}

/**
 * Turn untrusted artist-authored JSON into the only fields the shelf renders.
 *
 * Unknown root/item/release fields are not copied. Unknown protocol versions
 * and any malformed known field refuse the whole manifest rather than
 * presenting a partly trusted catalogue whose omissions look like deleted
 * releases.
 */
/**
 * Say which row was refused, without copying the row into the log.
 *
 * The id and the content type are enough to find it in the manifest and are
 * not secrets. Titles and URLs are left out: this runs server-side on a page
 * render, and an artist's unreleased title does not belong in a build log.
 */
/**
 * An envelope refusal: the document's identity is wrong, so there is no row to
 * name. Returns null so each call site stays a single statement.
 *
 * One bad row and one bad envelope both take the whole page down, and until
 * 7 November both did it in complete silence - a refusal that logged nothing
 * was how a writer/reader disagreement survived weeks. Whether a row SHOULD
 * take the page down is a separate question and still open; this only makes
 * the answer findable either way.
 */
const refuse = (manifestUrl: string, at: string, why: string): null => {
  console.warn(JSON.stringify({ at: "site-manager-manifest", manifestUrl, refused: at, why }))
  return null
}

const refused = (manifestUrl: string, at: string, raw: unknown) => {
  const row = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  console.warn(
    JSON.stringify({
      at: "site-manager-manifest",
      manifestUrl,
      refused: at,
      id: typeof row.id === "string" ? row.id : undefined,
      contentType: typeof row.contentType === "string" ? row.contentType : undefined,
      kind: typeof row.kind === "string" ? row.kind : undefined,
    })
  )
}

/**
 * `show` is the page: a bad row is dropped and the rest stays up.
 * `store` is the writer: a bad row refuses the document, so a publish cannot
 * save a file the page would then hide. Duplicate ids refuse in both modes.
 */
export const parseSiteManagerManifest = (
  input: string,
  manifestUrl: string,
  mode: "show" | "store" = "show",
): SiteManagerManifest | null => {
  if (new TextEncoder().encode(input).byteLength > MAX_MANIFEST_BYTES) {
    return refuse(manifestUrl, "size", `${new TextEncoder().encode(input).byteLength} bytes`)
  }

  let source: unknown
  let expected: URL
  try {
    source = JSON.parse(input)
    expected = new URL(manifestUrl)
  } catch {
    return refuse(manifestUrl, "json", "not parseable as JSON, or the manifest URL is not a URL")
  }
  if (expected.protocol !== "https:" || !isRecord(source)) {
    return refuse(manifestUrl, "envelope", "the manifest URL is not https, or the document is not an object")
  }
  if (source.protocol !== PROTOCOL || source.version !== VERSION) {
    return refuse(manifestUrl, "protocol", `protocol=${String(source.protocol)} version=${String(source.version)}`)
  }
  if (!isISOInstant(source.updatedAt) || !Array.isArray(source.items)) {
    return refuse(manifestUrl, "envelope", "updatedAt is not an ISO instant, or items is not an array")
  }
  if (source.items.length > MAX_ITEMS) {
    return refuse(manifestUrl, "items", `${source.items.length} items, limit ${MAX_ITEMS}`)
  }

  const items: SiteManagerManifestItem[] = []
  const itemIds = new Set<string>()
  // An indexed loop, not items.entries(): this tsconfig's target cannot
  // iterate an ArrayIterator without downlevelIteration.
  for (let index = 0; index < source.items.length; index += 1) {
    const raw = source.items[index]
    const item = parseItem(raw, expected.origin)
    if (!item) {
      // A bad row is dropped on the page. Refusing the document here took the
      // rest of the shelf down with it, including films. The writer still
      // refuses, so a publish cannot save a row the page would hide. A
      // duplicate id is not a bad row: the document contradicts itself.
      refused(manifestUrl, `items[${index}]`, raw)
      if (mode === "store") return null
      continue
    }
    if (itemIds.has(item.id)) {
      refused(manifestUrl, `items[${index}] duplicate id`, raw)
      return null
    }
    itemIds.add(item.id)
    items.push(item)
  }

  const parsed: SiteManagerManifest = {
    protocol: PROTOCOL,
    version: VERSION,
    updatedAt: source.updatedAt,
    items,
  }

  if ("releases" in source) {
    if (!Array.isArray(source.releases) || source.releases.length > MAX_RELEASES) {
      return refuse(manifestUrl, "releases", "releases is not an array, or is over the limit")
    }
    const itemsById = new Map(items.map((item) => [item.id, item]))
    const releases: SiteManagerManifestRelease[] = []
    const releaseIds = new Set<string>()
    const referenced = new Set<string>()
    for (let index = 0; index < source.releases.length; index += 1) {
      const raw = source.releases[index]
      const release = parseRelease(raw, itemsById)
      if (!release) {
        // Same as a bad item. `releases` stays an array, so the shelf does not
        // fall back to loose files and reveal a hidden one. An id that is also
        // an item id, or a second release with the same id, still refuses.
        refused(manifestUrl, `releases[${index}]`, raw)
        if (mode === "store") return null
        continue
      }
      if (releaseIds.has(release.id) || itemIds.has(release.id)) {
        refused(manifestUrl, `releases[${index}] duplicate id`, raw)
        return null
      }
      for (const id of [release.audio, release.reel, release.artwork, release.bundle]) {
        if (!id) continue
        if (referenced.has(id)) {
          refused(manifestUrl, `releases[${index}] reuses item ${id}`, raw)
          return null
        }
        referenced.add(id)
      }
      releaseIds.add(release.id)
      releases.push(release)
    }
    parsed.releases = releases
  }

  if ("movies" in source) {
    if (!Array.isArray(source.movies) || source.movies.length > MAX_ITEMS) {
      return refuse(manifestUrl, "movies", "movies is not an array, or is over the limit")
    }
    const movies: SiteManagerMovie[] = []
    const movieIds = new Set<string>()
    for (let index = 0; index < source.movies.length; index += 1) {
      const raw = source.movies[index]
      const movie = parseMovie(raw, expected.origin)
      if (!movie) {
        refused(manifestUrl, `movies[${index}]`, raw)
        if (mode === "store") return null
        continue
      }
      if (movieIds.has(movie.id) || itemIds.has(movie.id)) {
        refused(manifestUrl, `movies[${index}] duplicate id`, raw)
        return null
      }
      movieIds.add(movie.id)
      movies.push(movie)
    }
    parsed.movies = movies
  }

  return parsed
}

/**
 * A film entry. The poster may be empty: the shelf already draws a plain
 * frame when there is no image, and requiring one would refuse a film whose
 * file had already been stored.
 */
const parseMovie = (value: unknown, manifestOrigin: string): SiteManagerMovie | null => {
  if (!isRecord(value) || !isUUID(value.id)) return null
  const title = typeof value.title === "string" ? value.title.trim() : ""
  if (!title || title.length > 160 || !isISOInstant(value.publishedAt)) return null
  if (
    typeof value.bytes !== "number" ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > MAX_MEDIA_BYTES
  ) {
    return null
  }
  const url = sameOriginMedia(value.url, manifestOrigin, [".mp4", ".mov", ".webm"])
  if (!url) return null
  const poster = value.poster === ""
    ? ""
    : sameOriginMedia(value.poster, manifestOrigin, [".jpg", ".jpeg", ".png", ".webp"])
  if (poster === null) return null
  return {
    id: value.id.toLowerCase(),
    title,
    url,
    poster,
    bytes: value.bytes,
    publishedAt: value.publishedAt,
  }
}

const sameOriginMedia = (value: unknown, manifestOrigin: string, extensions: string[]) => {
  if (typeof value !== "string" || value.length > 1_000) return null
  let mediaUrl: URL
  try {
    mediaUrl = new URL(value)
  } catch {
    return null
  }
  if (
    mediaUrl.protocol !== "https:" ||
    mediaUrl.username ||
    mediaUrl.password ||
    mediaUrl.origin !== manifestOrigin ||
    !extensions.some((extension) => mediaUrl.pathname.toLowerCase().endsWith(extension))
  ) {
    return null
  }
  return mediaUrl.toString()
}

const readManifest = async (
  manifestUrl?: string
): Promise<SiteManagerManifest | null> => {
  if (!manifestUrl) return null

  let url: URL
  try {
    url = new URL(manifestUrl)
  } catch {
    return null
  }
  if (url.protocol !== "https:") return null

  try {
    const options = {
      headers: { accept: "application/json" },
      redirect: "error" as const,
      signal: AbortSignal.timeout(5_000),
      // A new film or sound can take this long to show. The manifest itself
      // is also sent with max-age=60. A failed fetch returns null, and the
      // caller must keep the static films rather than replace them with nothing.
      next: { revalidate: 60 },
    }
    const response = await fetch(url, options)
    if (!response.ok) return null

    const declared = Number(response.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > MAX_MANIFEST_BYTES) return null

    const text = await response.text()
    return parseSiteManagerManifest(text, url.toString())
  } catch {
    return null
  }
}

/**
 * A manifest outage empties only the dynamic half of one shelf. It must never
 * take down the artist page or hide the independent Medusa-backed releases.
 */
export const getSiteManagerItems = async (
  manifestUrl?: string
): Promise<SiteManagerManifestItem[]> => {
  return (await readManifest(manifestUrl))?.items ?? []
}

export type SiteManagerShelfEntry =
  | { kind: "release"; release: SiteManagerManifestRelease; items: SiteManagerManifestItem[] }
  | { kind: "item"; item: SiteManagerManifestItem }

export const shelfEntriesFrom = (
  parsed: SiteManagerManifest
): SiteManagerShelfEntry[] => {
  if (parsed.releases) {
    return parsed.releases
      .filter((release) => release.visible)
      .map((release) => ({ kind: "release", release, items: parsed.items }))
  }
  return parsed.items.map((item) => ({ kind: "item", item }))
}

/**
 * What the shelf actually draws.
 *
 * `releases` absent: Stage 1, render the file list. `releases` present: the
 * publisher has stated the catalogue, so leftover files are inventory and
 * hidden releases stay hidden. The website does not wrap one into the other.
 */
export const getSiteManagerMovies = async (
  manifestUrl?: string
): Promise<SiteManagerMovie[]> => {
  return (await readManifest(manifestUrl))?.movies ?? []
}

export const getSiteManagerShelf = async (
  manifestUrl?: string
): Promise<SiteManagerShelfEntry[]> => {
  const parsed = await readManifest(manifestUrl)
  if (!parsed) return []
  return shelfEntriesFrom(parsed)
}
