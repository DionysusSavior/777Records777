import {
  HeadObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type {
  IssuedUpload,
  PublishStorage,
  StoredUpload,
  UploadDescriptor,
} from "./core"

export type S3AdapterConfig = {
  bucket: string
  region: string
  endpoint?: string
  forcePathStyle?: boolean
}

/**
 * 777's storage seam. No Medusa type crosses it, so another site can replace
 * S3 with R2, Backblaze, a host-native object store, or its own implementation.
 */
export class S3PublishStorage implements PublishStorage {
  private readonly client: S3Client
  /**
   * Declared and assigned rather than written as a constructor parameter
   * property, so this file can be read by a runtime that only STRIPS types.
   *
   * A parameter property is not a type annotation: it emits an assignment, so
   * Node's type stripping refuses it outright with
   * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. That made this file unimportable from
   * `node --test`, which is how the studio service's flow test reaches it.
   *
   * It matters beyond the test. OFF-RENDER-ADMIN.md ports this directory to a
   * Lambda, away from Medusa's build - and the whole reason that port is
   * cheap is that site-manager is framework-independent. One line of syntax
   * only a transpiler understands quietly undoes that.
   */
  private readonly config: S3AdapterConfig

  constructor(config: S3AdapterConfig, client?: S3Client) {
    this.config = config
    this.client = client ?? new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
    })
  }

  async issueUpload(input: UploadDescriptor): Promise<IssuedUpload> {
    /**
     * WITHOUT THIS HEADER, NOTHING PUBLISHED HERE EVER DOWNLOADS ON IOS.
     *
     * The artist's media is served from storage on a different origin to the
     * page linking to it, and the HTML `download` attribute is IGNORED
     * cross-origin. Safari therefore navigated to the file and played it —
     * every "Free to download" link on 777records777.studio was a play button
     * for anyone on an iPhone. There is no shortcut: S3 refuses
     * `?response-content-disposition=` with a 400 for anonymous requests, so
     * the header has to live on the object, which means setting it here at
     * the moment the object is written.
     *
     * Safe for playback, which was the open question since a reel is both
     * played in the page and offered as a file: a `<video>` ignores
     * Content-Disposition. Verified against a live object carrying it —
     * readyState 4, no error.
     *
     * Two forms, per RFC 6266. The quoted ASCII one every browser understands,
     * and `filename*` so a name with accents or non-Latin script arrives
     * intact instead of mangled. `downloadNameFor` has already stripped the
     * control characters and quotes that would otherwise end the header early.
     */
    const disposition =
      `attachment; filename="${input.downloadName}"; ` +
      `filename*=UTF-8''${encodeURIComponent(input.downloadName)}`

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentDisposition: disposition,
      ContentLength: input.contentLength,
      ChecksumSHA256: input.checksumSha256,
    })
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
      // Bind these to the signature instead of letting the presigner hoist the
      // checksum into the query or omit them from the signed headers.
      // Completion checks them again against S3's object headers.
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
      signableHeaders: new Set(["content-type", "content-disposition"]),
    })
    /**
     * Returned so the phone sends it, and that is what makes this safe to ship
     * without an app release: the app sets EVERY header in this map on the PUT
     * rather than a fixed list of its own, so a new entry here is sent by
     * builds that have never heard of it. A header that were signed but not
     * returned would 403 every upload.
     */
    return {
      url,
      headers: {
        "content-type": input.contentType,
        "content-disposition": disposition,
        "x-amz-checksum-sha256": input.checksumSha256,
      },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    }
  }

  async inspectUpload(key: string): Promise<StoredUpload | null> {
    let result: HeadObjectCommandOutput
    try {
      result = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ChecksumMode: "ENABLED",
      }))
    } catch (error: any) {
      const status = error?.$metadata?.httpStatusCode
      if (status === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") {
        return null
      }
      throw error
    }

    return {
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      checksumSha256: result.ChecksumSHA256,
    }
  }
}
