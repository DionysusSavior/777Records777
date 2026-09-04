const PROTOCOL = "om7.site-manager.manifest"
const VERSION = 1
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_ITEMS = 500
const MAX_RELEASES = 500
const MAX_MEDIA_BYTES = 5 * 1024 * 1024 * 1024
const MAX_PRICE_CENTS = 1_000_000_000

type MediaRule = {
  kind: "audio" | "video" | "image" | "bundle"
  extensions: string[]
}

const MEDIA_RULES: Record<string, MediaRule> = {
  "audio/aiff": { kind: "audio", extensions: [".aif", ".aiff"] },
  "audio/mp4": { kind: "audio", extensions: [".m4a"] },
  "audio/mpeg": { kind: "audio", extensions: [".mp3"] },
  "audio/wav": { kind: "audio", extensions: [".wav"] },
  "video/mp4": { kind: "video", extensions: [".mp4"] },
  "video/quicktime": { kind: "video", extensions: [".mov"] },
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
  visible: boolean
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
export const parseSiteManagerManifest = (
  input: string,
  manifestUrl: string
): SiteManagerManifest | null => {
  if (new TextEncoder().encode(input).byteLength > MAX_MANIFEST_BYTES) return null

  let source: unknown
  let expected: URL
  try {
    source = JSON.parse(input)
    expected = new URL(manifestUrl)
  } catch {
    return null
  }
  if (expected.protocol !== "https:" || !isRecord(source)) return null
  if (source.protocol !== PROTOCOL || source.version !== VERSION) return null
  if (!isISOInstant(source.updatedAt) || !Array.isArray(source.items)) return null
  if (source.items.length > MAX_ITEMS) return null

  const items: SiteManagerManifestItem[] = []
  const itemIds = new Set<string>()
  for (const raw of source.items) {
    const item = parseItem(raw, expected.origin)
    if (!item || itemIds.has(item.id)) return null
    itemIds.add(item.id)
    items.push(item)
  }

  const parsed: SiteManagerManifest = {
    protocol: PROTOCOL,
    version: VERSION,
    updatedAt: source.updatedAt,
    items,
  }

  if (!("releases" in source)) return parsed
  if (!Array.isArray(source.releases) || source.releases.length > MAX_RELEASES) {
    return null
  }

  const itemsById = new Map(items.map((item) => [item.id, item]))
  const releases: SiteManagerManifestRelease[] = []
  const releaseIds = new Set<string>()
  const referenced = new Set<string>()
  for (const raw of source.releases) {
    const release = parseRelease(raw, itemsById)
    if (
      !release ||
      releaseIds.has(release.id) ||
      itemIds.has(release.id)
    ) {
      return null
    }
    for (const id of [release.audio, release.reel, release.artwork, release.bundle]) {
      if (!id) continue
      if (referenced.has(id)) return null
      referenced.add(id)
    }
    releaseIds.add(release.id)
    releases.push(release)
  }

  parsed.releases = releases
  return parsed
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
export const getSiteManagerShelf = async (
  manifestUrl?: string
): Promise<SiteManagerShelfEntry[]> => {
  const parsed = await readManifest(manifestUrl)
  if (!parsed) return []
  return shelfEntriesFrom(parsed)
}
