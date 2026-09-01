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

  constructor(private readonly config: S3AdapterConfig, client?: S3Client) {
    this.client = client ?? new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
    })
  }

  async issueUpload(input: UploadDescriptor): Promise<IssuedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
      ChecksumSHA256: input.checksumSha256,
    })
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
      // Bind both values to the signature instead of letting the presigner
      // hoist the checksum into the query or omit Content-Type from the signed
      // headers. Completion checks them again against S3's object headers.
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
      signableHeaders: new Set(["content-type"]),
    })
    return {
      url,
      headers: {
        "content-type": input.contentType,
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
