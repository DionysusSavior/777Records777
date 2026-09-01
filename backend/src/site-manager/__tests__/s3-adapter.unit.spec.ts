import { S3Client } from "@aws-sdk/client-s3"
import { S3PublishStorage } from "../s3-adapter"

describe("S3 Site Manager adapter", () => {
  it("signs the declared MIME type, byte count, and checksum into one PUT", async () => {
    const client = new S3Client({
      region: "us-east-2",
      credentials: {
        accessKeyId: "TEST-ONLY",
        secretAccessKey: "test-only-secret",
      },
    })
    const checksumSha256 = Buffer.alloc(32, 7).toString("base64")
    const adapter = new S3PublishStorage({
      bucket: "artist-bucket",
      region: "us-east-2",
    }, client)

    const issued = await adapter.issueUpload({
      key: "site-manager/id.mp3",
      contentType: "audio/mpeg",
      contentLength: 11,
      checksumSha256,
      expiresInSeconds: 900,
    })

    const url = new URL(issued.url)
    const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? []
    expect(url.host).toBe("artist-bucket.s3.us-east-2.amazonaws.com")
    expect(signedHeaders).toEqual(expect.arrayContaining([
      "content-length",
      "content-type",
      "host",
      "x-amz-checksum-sha256",
    ]))
    expect(url.searchParams.has("x-amz-checksum-sha256")).toBe(false)
    expect(issued.headers).toEqual({
      "content-type": "audio/mpeg",
      "x-amz-checksum-sha256": checksumSha256,
    })
  })
})
