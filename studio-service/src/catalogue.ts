import { randomUUID } from "node:crypto"
import type { PublishedObject } from "../../backend/src/site-manager/core.ts"

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

const itemId = (key: string) => {
  const file = key.split("/").pop() ?? ""
  const id = file.replace(/\.[^.]+$/, "")
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new CatalogueError(500, "catalogue_key", "The stored object key is not a catalogue id.")
  }
  return id.toLowerCase()
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
 * A Sounds publish against a manifest that has no `releases` array does not
 * invent one. Inventing it would hide every older file, because the website
 * treats a present array as the whole catalogue. A Movies publish writes
 * `movies` and does not add a Sounds row: a loose video is how a film used
 * to show up on the wrong shelf.
 */
export const applyCatalogue = (raw: string | null, published: PublishedObject, publishedAt: string) => {
  let source: Record<string, unknown>
  if (raw === null || raw.trim() === "") {
    source = {
      protocol: PROTOCOL,
      version: VERSION,
      updatedAt: publishedAt,
      items: [],
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
    id: itemId(published.key),
    kind: kindFor(published),
    title: published.title,
    url: published.publicUrl,
    contentType: published.contentType,
    bytes: published.contentLength,
    publishedAt,
  }
  source.items = [...items, item]
  if (Array.isArray(source.releases)) {
    const role = published.mediaKind === "reel"
      ? "reel"
      : published.mediaKind === "artwork"
        ? "artwork"
        : published.mediaKind === "bundle"
          ? "bundle"
          : "audio"
    /*
     Attach, or start one.

     Every completion used to append a release with a single role filled and
     the rest null, because nothing told the service that four uploads were
     one song. A reel published from the phone became its own entry on the
     page, beside the audio it belongs behind, and no player could ever know
     they were the same release.

     The id arrives inside the signed receipt, so a caller cannot name a
     release that is not theirs to add to. An id that matches nothing here
     starts a release under that id rather than a random one, which is what
     makes the order of the four uploads stop mattering.
    */
    const existing = published.releaseId
      ? source.releases.findIndex((r) => isRecord(r) && r.id === published.releaseId)
      : -1
    if (existing >= 0) {
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
      })
    } else {
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
export const listCatalogue = (raw: string | null, section: "sounds" | "movies"): CatalogueEntry[] => {
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
    return source.releases.flatMap((release) => {
      if (!isRecord(release) || release.visible === false) return []
      const audioId = textOf(release.audio)
      const audio = items.find((item) => item.id === audioId && item.kind === "audio")
      const url = audio ? textOf(audio.url) : null
      const title = textOf(release.title)
      const id = textOf(release.id)
      return url && title && id ? [{ id, title, url, removable: true }] : []
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
): CatalogueEntry[] => {
  const published = listCatalogue(raw, section)
  const seen = new Set(published.map((entry) => entry.url))
  const rest = storeItems.flatMap((item) =>
    seen.has(item.url) ? [] : [{ ...item, removable: false, managedBy }])
  return [...published, ...rest]
}

/**
 * Take one published URL off the page. Does not invent a `releases` array.
 * A Sounds removal also drops any release that used that file. A Movies
 * removal never touches Sounds.
 */
export const removeFromCatalogue = (
  raw: string,
  target: { url: string; section: "sounds" | "movies" },
  updatedAt: string,
) => {
  const source = parseCatalogue(raw)
  if (target.section === "movies") {
    const movies = Array.isArray(source.movies) ? source.movies.filter(isRecord) : []
    const next = movies.filter((movie) => movie.url !== target.url)
    if (next.length === movies.length) {
      throw new CatalogueError(404, "not_found", "That file is not on this page.")
    }
    source.movies = next
    source.updatedAt = updatedAt
    return JSON.stringify(source)
  }
  const items = (source.items as unknown[]).filter(isRecord)
  const removed = items.filter((item) => item.url === target.url)
  if (removed.length === 0) {
    throw new CatalogueError(404, "not_found", "That file is not on this page.")
  }
  const removedIds = new Set(removed.map((item) => item.id))
  source.items = items.filter((item) => item.url !== target.url)
  if (Array.isArray(source.releases)) {
    source.releases = source.releases.filter((release) => {
      if (!isRecord(release)) return false
      const ids = [release.audio, release.reel, release.artwork, release.bundle]
      return !ids.some((id) => typeof id === "string" && removedIds.has(id))
    })
  }
  source.updatedAt = updatedAt
  return JSON.stringify(source)
}

export const commitRemoval = async (
  store: ManifestStore,
  manifestKey: string,
  target: { url: string; section: "sounds" | "movies" },
  updatedAt: string,
) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.read(manifestKey)
    if (!current) throw new CatalogueError(404, "not_found", "That file is not on this page.")
    const body = removeFromCatalogue(current.body, target, updatedAt)
    const written = await store.write(manifestKey, body, current.etag)
    if ("etag" in written) return
  }
  throw new CatalogueError(409, "catalogue_conflict", "The page changed while that file was being removed. Try again.")
}

export const commitCatalogue = async (
  store: ManifestStore,
  manifestKey: string,
  published: PublishedObject,
  publishedAt: string,
) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.read(manifestKey)
    const next = applyCatalogue(current?.body ?? null, published, publishedAt)
    if (next.unchanged) return
    const written = await store.write(manifestKey, next.body, current?.etag ?? null)
    if ("etag" in written) return
  }
  throw new CatalogueError(409, "catalogue_conflict", "The catalogue changed while this file was being added. Retry completion; the file is already stored.")
}
