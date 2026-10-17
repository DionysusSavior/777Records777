import { S3Client } from "@aws-sdk/client-s3"
import { S3PublishStorage } from "../s3-adapter"
import { downloadNameFor } from "../core"

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
      downloadName: "In Time.mp3",
    })

    const url = new URL(issued.url)
    const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? []
    expect(url.host).toBe("artist-bucket.s3.us-east-2.amazonaws.com")
    expect(signedHeaders).toEqual(expect.arrayContaining([
      "content-length",
      "content-type",
      "content-disposition",
      "host",
      "x-amz-checksum-sha256",
    ]))
    expect(url.searchParams.has("x-amz-checksum-sha256")).toBe(false)
    expect(issued.headers).toEqual({
      "content-type": "audio/mpeg",
      "content-disposition":
        `attachment; filename="In Time.mp3"; filename*=UTF-8''${encodeURIComponent("In Time.mp3")}`,
      "x-amz-checksum-sha256": checksumSha256,
    })
  })

  /**
   * SIGNED AND RETURNED TOGETHER, OR UPLOADS 403.
   *
   * The phone sets every header in this map on the PUT. A header that is
   * signed but missing from the map is a signature the client cannot satisfy,
   * and every publish fails — so the two sets are asserted against each other
   * rather than each being checked alone.
   */
  it("returns every header it signed, so the client can satisfy the signature", async () => {
    const client = new S3Client({
      region: "us-east-2",
      credentials: { accessKeyId: "TEST-ONLY", secretAccessKey: "test-only-secret" },
    })
    const adapter = new S3PublishStorage({ bucket: "artist-bucket", region: "us-east-2" }, client)

    const issued = await adapter.issueUpload({
      key: "site-manager/id.wav",
      contentType: "audio/wav",
      contentLength: 11,
      checksumSha256: Buffer.alloc(32, 7).toString("base64"),
      expiresInSeconds: 900,
      downloadName: "In Time.wav",
    })

    const signed = new URL(issued.url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? []
    // host and content-length are set by the transport, not by the caller.
    const mustBeSent = signed.filter((h) => h !== "host" && h !== "content-length")
    for (const header of mustBeSent) {
      expect(Object.keys(issued.headers)).toContain(header)
    }
  })

  /**
   * The display name reaches a response header, so it is sanitised hard.
   * A newline in a header value is header injection; a quote ends the
   * quoted-string early and lets the rest be re-interpreted.
   */
  it("strips control characters and quotes out of the download name", () => {
    // Asserted as the property that matters rather than the exact spelling:
    // what must never survive is anything that can end the header or start a
    // new one. How the remainder reads is cosmetic and may change.
    const hostile = downloadNameFor('In "Time"\r\nX-Evil: 1', "wav")
    expect(hostile).not.toMatch(/[\r\n"\\]/)
    expect(hostile.endsWith(".wav")).toBe(true)

    expect(downloadNameFor("", "wav")).toBe("download.wav")
    expect(downloadNameFor("already.wav", "wav")).toBe("already.wav")
    expect(downloadNameFor("In Time", "wav")).toBe("In Time.wav")
  })
})
