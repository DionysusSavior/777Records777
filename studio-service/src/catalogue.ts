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
  if (items.some((item) => isRecord(item) && item.url === published.publicUrl)) {
    return { body: raw ?? JSON.stringify(source), unchanged: true }
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
    source.releases = [
      ...source.releases,
      {
        id: randomUUID(),
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
  source.updatedAt = publishedAt
  return { body: JSON.stringify(source), unchanged: false }
}

export type CatalogueEntry = { id: string; title: string; url: string }

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
      return url && title && id ? [{ id, title, url }] : []
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
      return url && title && id ? [{ id, title, url }] : []
    })
  }
  return items.flatMap((item) => {
    if (item.kind !== "audio") return []
    const url = textOf(item.url)
    const title = textOf(item.title)
    const id = textOf(item.id)
    return url && title && id ? [{ id, title, url }] : []
  })
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
