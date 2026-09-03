const PROTOCOL = "om7.site-manager.manifest"
const VERSION = 1
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_ITEMS = 500
const MAX_MEDIA_BYTES = 5 * 1024 * 1024 * 1024

type MediaRule = {
  kind: "audio" | "video"
  extensions: string[]
}

const MEDIA_RULES: Record<string, MediaRule> = {
  "audio/aiff": { kind: "audio", extensions: [".aif", ".aiff"] },
  "audio/mp4": { kind: "audio", extensions: [".m4a"] },
  "audio/mpeg": { kind: "audio", extensions: [".mp3"] },
  "audio/wav": { kind: "audio", extensions: [".wav"] },
  "video/mp4": { kind: "video", extensions: [".mp4"] },
  "video/quicktime": { kind: "video", extensions: [".mov"] },
}

export type SiteManagerManifestItem = {
  id: string
  kind: "audio" | "video"
  title: string
  url: string
  contentType: string
  bytes: number
  publishedAt: string
}

export type SiteManagerManifest = {
  protocol: typeof PROTOCOL
  version: typeof VERSION
  updatedAt: string
  items: SiteManagerManifestItem[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isISOInstant = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value))

const isUUID = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const parseItem = (
  value: unknown,
  manifestOrigin: string
): SiteManagerManifestItem | null => {
  if (!isRecord(value) || !isUUID(value.id)) return null

  const contentType = typeof value.contentType === "string"
    ? value.contentType.toLowerCase()
    : ""
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
    !rule.extensions.some((extension) => mediaUrl.pathname.toLowerCase().endsWith(extension))
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

/**
 * Turn untrusted artist-authored JSON into the only fields the shelf renders.
 *
 * Unknown root/item fields are not copied. Unknown protocol versions and any
 * malformed known field refuse the whole manifest rather than presenting a
 * partly trusted catalogue whose omissions look like deleted releases.
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
  const ids = new Set<string>()
  for (const raw of source.items) {
    const item = parseItem(raw, expected.origin)
    if (!item || ids.has(item.id)) return null
    ids.add(item.id)
    items.push(item)
  }

  return {
    protocol: PROTOCOL,
    version: VERSION,
    updatedAt: source.updatedAt,
    items,
  }
}

/**
 * A manifest outage empties only the dynamic half of one shelf. It must never
 * take down the artist page or hide the independent Medusa-backed releases.
 */
export const getSiteManagerItems = async (
  manifestUrl?: string
): Promise<SiteManagerManifestItem[]> => {
  if (!manifestUrl) return []

  let url: URL
  try {
    url = new URL(manifestUrl)
  } catch {
    return []
  }
  if (url.protocol !== "https:") return []

  try {
    const options = {
      headers: { accept: "application/json" },
      redirect: "error" as const,
      signal: AbortSignal.timeout(5_000),
      next: { revalidate: 60 },
    }
    const response = await fetch(url, options)
    if (!response.ok) return []

    const declared = Number(response.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > MAX_MANIFEST_BYTES) return []

    const text = await response.text()
    return parseSiteManagerManifest(text, url.toString())?.items ?? []
  } catch {
    return []
  }
}
