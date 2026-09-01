import { MAX_SINGLE_PUT_BYTES, createSiteManager } from "./core"
import { S3PublishStorage } from "./s3-adapter"

const required = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

const positiveInteger = (name: string, fallback: number, ceiling: number) => {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
    throw new Error(`${name} must be an integer from 1 through ${ceiling}`)
  }
  return value
}

export const createSiteManagerFromEnv = () => {
  const tokenSha256 = required("OM7_SITE_MANAGER_TOKEN_SHA256")
  if (!/^[a-f0-9]{64}$/i.test(tokenSha256)) {
    throw new Error("OM7_SITE_MANAGER_TOKEN_SHA256 must be a SHA-256 hex digest")
  }

  const publicBaseUrl = required("OM7_SITE_MANAGER_PUBLIC_BASE_URL")
  const parsedPublicBase = new URL(publicBaseUrl)
  if (parsedPublicBase.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("OM7_SITE_MANAGER_PUBLIC_BASE_URL must use https in production")
  }

  const receiptSecret = required("OM7_SITE_MANAGER_RECEIPT_SECRET")
  if (receiptSecret.length < 32) {
    throw new Error("OM7_SITE_MANAGER_RECEIPT_SECRET must be at least 32 characters")
  }

  const keyPrefix = (process.env.OM7_SITE_MANAGER_KEY_PREFIX ?? "site-manager")
    .replace(/^\/+|\/+$/g, "")
  if (!/^[a-zA-Z0-9/_-]{1,120}$/.test(keyPrefix)) {
    throw new Error("OM7_SITE_MANAGER_KEY_PREFIX contains unsupported characters")
  }

  const storage = new S3PublishStorage({
    bucket: required("OM7_SITE_MANAGER_S3_BUCKET"),
    region: required("OM7_SITE_MANAGER_S3_REGION"),
    endpoint: process.env.OM7_SITE_MANAGER_S3_ENDPOINT,
    forcePathStyle: process.env.OM7_SITE_MANAGER_S3_FORCE_PATH_STYLE === "true",
  })

  return createSiteManager({
    tokenSha256,
    receiptSecret,
    publicBaseUrl: parsedPublicBase.toString(),
    keyPrefix,
    maxBytes: positiveInteger(
      "OM7_SITE_MANAGER_MAX_BYTES",
      MAX_SINGLE_PUT_BYTES,
      MAX_SINGLE_PUT_BYTES,
    ),
    uploadTtlSeconds: positiveInteger("OM7_SITE_MANAGER_UPLOAD_TTL_SECONDS", 900, 3600),
    receiptTtlSeconds: positiveInteger("OM7_SITE_MANAGER_RECEIPT_TTL_SECONDS", 86400, 604800),
  }, storage)
}
