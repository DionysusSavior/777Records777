import type { PublishSection } from "../../backend/src/site-manager/core.ts"

/**
 * The only destinations publishing can name.
 *
 * A request that supplies a bucket, a prefix or a URL is ignored. The id is
 * looked up here, and the lookup is the whole of the caller's influence.
 * Viz and Dionysus Savior share a bucket and do not share a prefix. Sounds
 * and Movies for one artist share a manifest and do not share a grant.
 */
export type StudioDestination = {
  id: string
  artistName: string
  handle: string
  section: PublishSection
  siteHost: string
  bucket: string
  region: string
  prefix: string
  manifestKey: string
  publicBaseUrl: string
  pageUrl: string
}

const BUCKET = "777records777productpageassets"
const REGION = "us-east-2"
const PUBLIC_BASE = `https://${BUCKET}.s3.${REGION}.amazonaws.com/`
const SITE = "https://777records777.studio"

const destination = (
  id: string,
  artistName: string,
  handle: string,
  section: PublishSection,
  prefix: string,
): StudioDestination => ({
  id,
  artistName,
  handle,
  section,
  siteHost: "777records777.studio",
  bucket: BUCKET,
  region: REGION,
  prefix,
  manifestKey: `${prefix}/index.json`,
  publicBaseUrl: PUBLIC_BASE,
  pageUrl: `${SITE}/us/artists/${handle}`,
})

export const DESTINATIONS: readonly StudioDestination[] = [
  destination("viz-sounds", "Viz", "viz", "sounds", "site-manager/viz"),
  destination("viz-movies", "Viz", "viz", "movies", "site-manager/viz"),
  destination("dionysus-savior-sounds", "Dionysus Savior", "dionysus-savior", "sounds", "site-manager/dion"),
  destination("dionysus-savior-movies", "Dionysus Savior", "dionysus-savior", "movies", "site-manager/dion"),
]

export const destinationById = (id: unknown): StudioDestination | null => {
  if (typeof id !== "string") return null
  return DESTINATIONS.find((item) => item.id === id) ?? null
}

export const labelFor = (destination: StudioDestination) =>
  `${destination.artistName} → ${destination.siteHost} → ${destination.section === "movies" ? "Movies" : "Sounds"}`

/** How long a presigned PUT can still be used after a grant is revoked. */
export const UPLOAD_TTL_SECONDS = 900

export const UPLOAD_TTL_NOTE =
  "A presigned upload URL already handed to a phone stays usable until it expires, which is 15 minutes. Revocation refuses completion, so the object is not added to the page. The URL cannot be clawed back from S3."
