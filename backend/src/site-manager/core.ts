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

export type BeginUploadInput = {
  filename?: unknown
  mediaKind?: unknown
  contentType?: unknown
  contentLength?: unknown
  checksumSha256?: unknown
}

export type UploadDescriptor = {
  key: string
  contentType: string
  contentLength: number
  checksumSha256: string
  expiresInSeconds: number
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

export type SiteManagerConfig = {
  tokenSha256: string
  receiptSecret: string
  publicBaseUrl: string
  keyPrefix: string
  maxBytes: number
  uploadTtlSeconds: number
  receiptTtlSeconds: number
}

type Receipt = {
  v: 1
  key: string
  mediaKind: MediaKind
  contentType: string
  contentLength: number
  checksumSha256: string
  publicUrl: string
  expiresAt: number
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
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
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
    if (
      receipt.v !== 1 ||
      typeof receipt.key !== "string" ||
      typeof receipt.publicUrl !== "string" ||
      typeof receipt.expiresAt !== "number"
    ) {
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

export const createSiteManager = (config: SiteManagerConfig, storage: PublishStorage) => ({
  async begin(authorization: string | undefined, raw: BeginUploadInput) {
    requireAuthorization(authorization, config)

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

    // The client filename is deliberately not used as a storage key. Besides
    // path traversal, same-origin HTML/SVG uploads would turn storage into an
    // executable-content surface. The allowlisted MIME type chooses the suffix.
    const key = `${config.keyPrefix}/${randomUUID()}.${type.extension}`
    const publicUrl = publicUrlFor(config.publicBaseUrl, key)
    const issued = await storage.issueUpload({
      key,
      contentType,
      contentLength,
      checksumSha256,
      expiresInSeconds: config.uploadTtlSeconds,
    })
    const receipt: Receipt = {
      v: 1,
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
    requireAuthorization(authorization, config)
    const receipt = decodeReceipt(uploadReceipt, config.receiptSecret)
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

    return {
      protocol: SITE_MANAGER_PROTOCOL,
      version: SITE_MANAGER_VERSION,
      status: "published" as const,
      publicUrl: receipt.publicUrl,
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
