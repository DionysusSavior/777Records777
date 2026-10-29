import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"

export const SITE_MANAGER_PROTOCOL = "om7.site-manager"
export const SITE_MANAGER_VERSION = 1
export const MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024

export type MediaKind = "audio" | "reel" | "video" | "artwork" | "bundle"

/**
 * The name a browser saves the file as, from a name the client chose.
 *
 * The key is a UUID on purpose — see the comment where it is built — so
 * without this a download arrives called `8db3c249-….wav`, which is not a
 * song. The display name is the one place the client's filename is allowed to
 * matter, and it reaches a RESPONSE HEADER, so it is sanitised hard.
 *
 * Control characters and CR/LF go first: a newline in a header value is header
 * injection, and this value is attacker-controlled in the sense that anybody
 * holding a publishing credential supplies it. Quotes and backslashes go too,
 * because the ASCII form is a quoted-string and either would end it early.
 *
 * Both forms are emitted by the caller: a plain `filename=` that is safe in
 * any browser, and RFC 6266's `filename*=UTF-8''…` so a name with accents or
 * non-Latin script survives rather than being flattened to underscores.
 */
export const downloadNameFor = (raw: unknown, extension: string): string => {
  const given = typeof raw === "string" ? raw.trim() : ""
  // eslint-disable-next-line no-control-regex
  const cleaned = given.replace(/[\u0000-\u001f\u007f"\\]/g, "").slice(0, 120).trim()
  if (!cleaned) return `download.${extension}`
  return cleaned.toLowerCase().endsWith(`.${extension}`) ? cleaned : `${cleaned}.${extension}`
}

export type PublishSection = "sounds" | "movies"

export type BeginUploadInput = {
  filename?: unknown
  mediaKind?: unknown
  contentType?: unknown
  contentLength?: unknown
  checksumSha256?: unknown
  /**
   * Ignored by the single-prefix manager Render still runs. The studio
   * service requires it, and the grant — not this string — chooses the prefix.
   */
  destinationId?: unknown
  section?: unknown
  title?: unknown
}

export type UploadDescriptor = {
  key: string
  contentType: string
  contentLength: number
  checksumSha256: string
  expiresInSeconds: number
  /** The name a browser should save the file as. See downloadNameFor. */
  downloadName: string
}

export type IssuedUpload = {
  url: string
  headers: Record<string, string>
  expiresAt: string
}

export type StoredUpload = {
  contentType?: string
  contentLength?: number
  checksumSha256?: string
}

/**
 * The protocol core knows that it needs one direct upload and one later HEAD.
 * It does not know that 777 uses S3 or that its HTTP shell is Medusa. A site
 * on another storage provider implements this interface and keeps the routes.
 */
export interface PublishStorage {
  issueUpload(input: UploadDescriptor): Promise<IssuedUpload>
  inspectUpload(key: string): Promise<StoredUpload | null>
}

/**
 * What a publishing grant is allowed to touch.
 *
 * The caller does not supply the prefix or the public base. Those come from
 * the destination registry after the token has been resolved, so a body that
 * names somebody else's artist cannot widen the upload.
 */
export type ResolvedGrant = {
  keyPrefix: string
  publicBaseUrl: string
  destinationId: string
  grantId: string
  grantVersion: number
  section: PublishSection
}

export type PublishedObject = {
  key: string
  publicUrl: string
  mediaKind: MediaKind
  contentType: string
  contentLength: number
  checksumSha256: string
  downloadName: string
  title: string
  destinationId: string
  section: PublishSection
  /**
   * The release these files belong to, when the phone said so.
   *
   * Absent means what it always meant: this file is a release of its own.
   * Present means attach it to that release instead of starting another, so
   * a reel and its audio stop arriving as two unrelated songs.
   */
  releaseId?: string
}

export type SiteManagerConfig = {
  tokenSha256: string
  receiptSecret: string
  publicBaseUrl: string
  keyPrefix: string
  maxBytes: number
  uploadTtlSeconds: number
  receiptTtlSeconds: number
  /**
   * Present only on the studio service.
   *
   * Render's manager leaves this unset and keeps checking the one configured
   * digest. Setting it does not make that digest a pass for every artist.
   */
  resolveGrant?: (
    authorization: string | undefined,
    destinationId: unknown,
  ) => Promise<ResolvedGrant>
  /**
   * Runs after the stored object matches the receipt and before success.
   * A throw here must leave the object in place so the same receipt can be
   * completed again without uploading twice.
   */
  onPublished?: (published: PublishedObject) => Promise<{ pageUrl: string }>
}

type Receipt = {
  v: 1 | 2
  key: string
  mediaKind: MediaKind
  contentType: string
  contentLength: number
  checksumSha256: string
  publicUrl: string
  expiresAt: number
  destinationId?: string
  grantId?: string
  grantVersion?: number
  section?: PublishSection
  title?: string
  /**
   * Carried HERE and not re-read from the completion body on purpose. The
   * receipt is HMAC-signed, so a caller cannot move a file onto a release
   * that is not theirs by editing a request; the id is fixed at the moment
   * the upload was authorised.
   */
  releaseId?: string
}

const CONTENT_TYPES: Record<string, { extension: string; kinds: MediaKind[] }> = {
  "audio/aac": { extension: "aac", kinds: ["audio"] },
  "audio/flac": { extension: "flac", kinds: ["audio"] },
  "audio/m4a": { extension: "m4a", kinds: ["audio"] },
  "audio/mp4": { extension: "m4a", kinds: ["audio"] },
  "audio/mpeg": { extension: "mp3", kinds: ["audio"] },
  "audio/wav": { extension: "wav", kinds: ["audio"] },
  "audio/x-wav": { extension: "wav", kinds: ["audio"] },
  "video/mp4": { extension: "mp4", kinds: ["reel", "video"] },
  "video/quicktime": { extension: "mov", kinds: ["reel", "video"] },
  "video/webm": { extension: "webm", kinds: ["reel", "video"] },
  "image/jpeg": { extension: "jpg", kinds: ["artwork"] },
  "image/png": { extension: "png", kinds: ["artwork"] },
  "image/webp": { extension: "webp", kinds: ["artwork"] },
  "application/octet-stream": { extension: "om7", kinds: ["bundle"] },
}

export class SiteManagerError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const canonicalSha256 = (value: unknown) => {
  if (typeof value !== "string") return null
  try {
    const bytes = Buffer.from(value, "base64")
    return bytes.length === 32 && bytes.toString("base64") === value
      ? value
      : null
  } catch {
    return null
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const publicUrlFor = (base: string, key: string) => {
  const path = key.split("/").map(encodeURIComponent).join("/")
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString()
}

const bearerToken = (authorization?: string) => {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i)
  return match?.[1] ?? null
}

export const authorize = (authorization: string | undefined, expectedHash: string) => {
  const token = bearerToken(authorization)
  if (!token || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false

  const actual = Buffer.from(createHash("sha256").update(token).digest("hex"), "utf8")
  const expected = Buffer.from(expectedHash.toLowerCase(), "utf8")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const encodeReceipt = (receipt: Receipt, secret: string) => {
  const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url")
  const signature = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

const decodeReceipt = (value: unknown, secret: string): Receipt => {
  if (typeof value !== "string" || value.length > 4096) {
    throw new SiteManagerError(400, "invalid_receipt", "The upload receipt is invalid.")
  }
  const [payload, signature, extra] = value.split(".")
  if (!payload || !signature || extra) {
    throw new SiteManagerError(400, "invalid_receipt", "The upload receipt is invalid.")
  }

  const expected = createHmac("sha256", secret).update(payload).digest()
  let supplied: Buffer
  try {
    supplied = Buffer.from(signature, "base64url")
  } catch {
    throw new SiteManagerError(400, "invalid_receipt", "The upload receipt is invalid.")
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new SiteManagerError(400, "invalid_receipt", "The upload receipt is invalid.")
  }

  try {
    const receipt = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Receipt
    const baseOk = (receipt.v === 1 || receipt.v === 2) &&
      typeof receipt.key === "string" &&
      typeof receipt.publicUrl === "string" &&
      typeof receipt.expiresAt === "number"
    const grantOk = receipt.v !== 2 || (
      typeof receipt.destinationId === "string" &&
      typeof receipt.grantId === "string" &&
      typeof receipt.grantVersion === "number" &&
      (receipt.section === "sounds" || receipt.section === "movies") &&
      typeof receipt.title === "string" &&
      (receipt.releaseId === undefined ||
        (typeof receipt.releaseId === "string" && UUID.test(receipt.releaseId)))
    )
    if (!baseOk || !grantOk) {
      throw new Error("bad shape")
    }
    if (receipt.expiresAt < Date.now()) {
      throw new SiteManagerError(410, "receipt_expired", "The upload receipt has expired.")
    }
    return receipt
  } catch (error) {
    if (error instanceof SiteManagerError) throw error
    throw new SiteManagerError(400, "invalid_receipt", "The upload receipt is invalid.")
  }
}

const requireAuthorization = (authorization: string | undefined, config: SiteManagerConfig) => {
  if (!authorize(authorization, config.tokenSha256)) {
    throw new SiteManagerError(401, "unauthorized", "The publishing credential is not valid.")
  }
}

const titleFor = (raw: unknown, fallback: string) => {
  const given = typeof raw === "string" ? raw.trim() : ""
  // eslint-disable-next-line no-control-regex
  const cleaned = given.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160).trim()
  return cleaned || fallback
}

const sectionAllows = (section: PublishSection, mediaKind: MediaKind) => {
  if (section === "movies") return mediaKind === "video"
  return mediaKind !== "video"
}

export const createSiteManager = (config: SiteManagerConfig, storage: PublishStorage) => ({
  async begin(authorization: string | undefined, raw: BeginUploadInput) {
    // The grant is resolved before any other check so a bad destination never
    // reaches storage. The single-prefix manager has no resolver and still
    // checks its one digest before it looks at the file.
    const scope = config.resolveGrant
      ? await config.resolveGrant(authorization, raw.destinationId)
      : null
    if (!scope) requireAuthorization(authorization, config)

    const mediaKind = raw.mediaKind
    if (
      mediaKind !== "audio" &&
      mediaKind !== "reel" &&
      mediaKind !== "video" &&
      mediaKind !== "artwork" &&
      mediaKind !== "bundle"
    ) {
      throw new SiteManagerError(400, "invalid_request", "mediaKind must be audio, reel, video, artwork, or bundle.")
    }

    const contentType = typeof raw.contentType === "string"
      ? raw.contentType.trim().toLowerCase()
      : ""
    const type = CONTENT_TYPES[contentType]
    if (!type || !type.kinds.includes(mediaKind)) {
      throw new SiteManagerError(415, "unsupported_media_type", "That media type is not supported for this kind of publish.")
    }
    if (scope && !sectionAllows(scope.section, mediaKind)) {
      throw new SiteManagerError(
        415,
        "unsupported_media_type",
        scope.section === "movies"
          ? "Movies accepts a video. Sounds is a different destination."
          : "Sounds does not accept a movie. Choose the Movies destination for a film.",
      )
    }

    const contentLength = raw.contentLength
    if (
      typeof contentLength !== "number" ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > config.maxBytes
    ) {
      throw new SiteManagerError(413, "invalid_size", `The file must be between 1 and ${config.maxBytes} bytes.`)
    }

    const checksumSha256 = canonicalSha256(raw.checksumSha256)
    if (!checksumSha256) {
      throw new SiteManagerError(400, "invalid_checksum", "checksumSha256 must be a base64-encoded SHA-256 digest.")
    }

    /*
     Optional, and a UUID when it is there. It becomes an id inside the
     manifest, so an arbitrary string would let a caller choose how its
     release is addressed and collide with one already published.
    */
    const releaseId = raw.releaseId === undefined || raw.releaseId === null
      ? undefined
      : typeof raw.releaseId === "string" && UUID.test(raw.releaseId)
        ? raw.releaseId.toLowerCase()
        : null
    if (releaseId === null) {
      throw new SiteManagerError(400, "invalid_request", "releaseId must be a UUID.")
    }

    // The client filename is deliberately not used as a storage key. Besides
    // path traversal, same-origin HTML/SVG uploads would turn storage into an
    // executable-content surface. The allowlisted MIME type chooses the suffix.
    const keyPrefix = scope?.keyPrefix ?? config.keyPrefix
    const publicBaseUrl = scope?.publicBaseUrl ?? config.publicBaseUrl
    /*
     A bundle is a materialization of its release, not a thing with its own
     identity, so it is named by the release and rebuilding one overwrites it.
     A random key would leave a 70 MB orphan in storage every time artwork was
     added and the bundle rebuilt. Everything else keeps a fresh key: two
     uploads of the same song are two files, and a client must not be able to
     choose where a file lands.
    */
    const key = mediaKind === "bundle" && releaseId
      ? `${keyPrefix}/${releaseId}.${type.extension}`
      : `${keyPrefix}/${randomUUID()}.${type.extension}`
    const downloadName = downloadNameFor(raw.filename, type.extension)
    const title = titleFor(raw.title, downloadName)
    const publicUrl = publicUrlFor(publicBaseUrl, key)
    const issued = await storage.issueUpload({
      key,
      contentType,
      contentLength,
      checksumSha256,
      expiresInSeconds: config.uploadTtlSeconds,
      downloadName,
    })
    const receipt: Receipt = {
      v: scope ? 2 : 1,
      key,
      mediaKind,
      contentType,
      contentLength,
      checksumSha256,
      publicUrl,
      // S3 checks the signed URL when the PUT begins, so a large upload may
      // validly finish after that URL's short lifetime. Completion gets its
      // own longer window instead of falsely rejecting that successful PUT.
      expiresAt: Date.now() + config.receiptTtlSeconds * 1000,
      ...(scope
        ? {
            destinationId: scope.destinationId,
            grantId: scope.grantId,
            grantVersion: scope.grantVersion,
            section: scope.section,
            title,
            ...(releaseId ? { releaseId } : {}),
          }
        : {}),
    }

    return {
      protocol: SITE_MANAGER_PROTOCOL,
      version: SITE_MANAGER_VERSION,
      upload: {
        method: "PUT" as const,
        url: issued.url,
        headers: issued.headers,
        expiresAt: issued.expiresAt,
      },
      uploadReceipt: encodeReceipt(receipt, config.receiptSecret),
      completePath: "/uploads/complete",
    }
  },

  async complete(authorization: string | undefined, uploadReceipt: unknown) {
    const receipt = decodeReceipt(uploadReceipt, config.receiptSecret)
    let scope: ResolvedGrant | null = null
    if (config.resolveGrant) {
      // A version-1 receipt has no destination. Completing it here would file
      // it under whichever grant the token holds now.
      if (receipt.v !== 2 || !receipt.destinationId) {
        throw new SiteManagerError(400, "invalid_receipt", "The upload receipt is invalid.")
      }
      scope = await config.resolveGrant(authorization, receipt.destinationId)
      if (
        scope.grantId !== receipt.grantId ||
        scope.grantVersion !== receipt.grantVersion ||
        scope.section !== receipt.section ||
        !receipt.key.startsWith(`${scope.keyPrefix}/`)
      ) {
        throw new SiteManagerError(401, "unauthorized", "This publishing grant is no longer valid for that upload.")
      }
    } else {
      requireAuthorization(authorization, config)
      if (receipt.v !== 1) {
        throw new SiteManagerError(400, "invalid_receipt", "The upload receipt is invalid.")
      }
    }
    const stored = await storage.inspectUpload(receipt.key)
    if (!stored) {
      throw new SiteManagerError(409, "upload_missing", "The upload is not present in the site's storage.")
    }
    if (
      stored.contentLength !== receipt.contentLength ||
      stored.contentType?.toLowerCase() !== receipt.contentType ||
      stored.checksumSha256 !== receipt.checksumSha256
    ) {
      throw new SiteManagerError(409, "upload_mismatch", "The stored file does not match the upload request.")
    }

    let pageUrl: string | undefined
    if (scope && config.onPublished) {
      const published = await config.onPublished({
        key: receipt.key,
        publicUrl: receipt.publicUrl,
        mediaKind: receipt.mediaKind,
        contentType: receipt.contentType,
        contentLength: receipt.contentLength,
        checksumSha256: receipt.checksumSha256,
        downloadName: downloadNameFor(receipt.title, receipt.key.split(".").pop() || "bin"),
        title: receipt.title || "Untitled",
        destinationId: scope.destinationId,
        section: scope.section,
        releaseId: receipt.releaseId,
      })
      pageUrl = published.pageUrl
    }

    return {
      protocol: SITE_MANAGER_PROTOCOL,
      version: SITE_MANAGER_VERSION,
      status: "published" as const,
      publicUrl: receipt.publicUrl,
      pageUrl,
      // Version 1's smallest useful audio case has no generated landing page.
      // A richer adapter may later make this a site page instead of the object.
      downloadUrl: receipt.mediaKind === "audio" || receipt.mediaKind === "bundle"
        ? receipt.publicUrl
        : undefined,
      mediaKind: receipt.mediaKind,
      contentType: receipt.contentType,
      contentLength: receipt.contentLength,
      checksumSha256: receipt.checksumSha256,
    }
  },
})
