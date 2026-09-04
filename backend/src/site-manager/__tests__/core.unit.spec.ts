import { createHash } from "node:crypto"
import {
  createSiteManager,
  type PublishStorage,
  type StoredUpload,
  type UploadDescriptor,
} from "../core"

const token = "osm1_test-token-with-enough-entropy-for-the-fixture"
const checksumSha256 = createHash("sha256").update("audio bytes").digest("base64")

const makeStorage = () => {
  let issued: UploadDescriptor | undefined
  let stored: StoredUpload | null = null
  const storage: PublishStorage = {
    async issueUpload(input) {
      issued = input
      stored = {
        contentType: input.contentType,
        contentLength: input.contentLength,
        checksumSha256: input.checksumSha256,
      }
      return {
        url: "https://uploads.example.test/one-signed-object",
        headers: {
          "content-type": input.contentType,
          "x-amz-checksum-sha256": input.checksumSha256,
        },
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      }
    },
    async inspectUpload() {
      return stored
    },
  }
  return { storage, issued: () => issued, setStored: (value: StoredUpload | null) => { stored = value } }
}

const makeManager = () => {
  const fake = makeStorage()
  return {
    ...fake,
    manager: createSiteManager({
      tokenSha256: createHash("sha256").update(token).digest("hex"),
      receiptSecret: "test-only-receipt-secret-that-is-long-enough",
      publicBaseUrl: "https://media.artist.example/",
      keyPrefix: "site-manager",
      maxBytes: 1_000_000,
      uploadTtlSeconds: 900,
      receiptTtlSeconds: 86_400,
    }, fake.storage),
  }
}

const validRequest = {
  filename: "../../album<script>.mp3",
  mediaKind: "audio",
  contentType: "audio/mpeg",
  contentLength: 11,
  checksumSha256,
}

describe("Site Manager protocol core", () => {
  it("issues one direct upload and returns its verified public URL", async () => {
    const { manager, issued } = makeManager()
    const begun = await manager.begin(`Bearer ${token}`, validRequest)

    expect(begun.upload.method).toBe("PUT")
    expect(issued()?.key).toMatch(/^site-manager\/[0-9a-f-]+\.mp3$/)
    expect(issued()?.key).not.toContain("album")

    const completed = await manager.complete(`Bearer ${token}`, begun.uploadReceipt)
    expect(completed.status).toBe("published")
    expect(completed.publicUrl).toMatch(/^https:\/\/media\.artist\.example\/site-manager\/.+\.mp3$/)
    expect(completed.downloadUrl).toBe(completed.publicUrl)
  })

  it("does not touch storage for a bad publishing credential", async () => {
    const { manager, issued } = makeManager()
    await expect(manager.begin("Bearer wrong", validRequest)).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    })
    expect(issued()).toBeUndefined()
  })

  it("rejects executable and mismatched media types", async () => {
    const { manager } = makeManager()
    await expect(manager.begin(`Bearer ${token}`, {
      ...validRequest,
      contentType: "image/svg+xml",
    })).rejects.toMatchObject({ status: 415, code: "unsupported_media_type" })

    await expect(manager.begin(`Bearer ${token}`, {
      ...validRequest,
      mediaKind: "artwork",
      contentType: "image/svg+xml",
    })).rejects.toMatchObject({ status: 415, code: "unsupported_media_type" })

    await expect(manager.begin(`Bearer ${token}`, {
      ...validRequest,
      mediaKind: "video",
    })).rejects.toMatchObject({ status: 415, code: "unsupported_media_type" })
  })

  it("accepts a .om7 bundle served as octet-stream", async () => {
    const { manager, issued } = makeManager()
    const begun = await manager.begin(`Bearer ${token}`, {
      ...validRequest,
      filename: "In Time.om7",
      mediaKind: "bundle",
      contentType: "application/octet-stream",
    })
    expect(issued()?.key).toMatch(/^site-manager\/[0-9a-f-]+\.om7$/)
    expect(begun.upload.headers["content-type"]).toBe("application/octet-stream")
  })

  it("rejects a forged receipt and a mismatched stored object", async () => {
    const { manager, setStored } = makeManager()
    const begun = await manager.begin(`Bearer ${token}`, validRequest)

    await expect(manager.complete(`Bearer ${token}`, `${begun.uploadReceipt}x`))
      .rejects.toMatchObject({ status: 400, code: "invalid_receipt" })

    setStored({
      contentType: validRequest.contentType,
      contentLength: validRequest.contentLength + 1,
      checksumSha256,
    })
    await expect(manager.complete(`Bearer ${token}`, begun.uploadReceipt))
      .rejects.toMatchObject({ status: 409, code: "upload_mismatch" })
  })
})
