type SoundDownload = {
  url: string
  label: string
  /**
   * A `.om7` release bundle: the song, the vertical reel that plays behind it
   * in OM7Player, artwork, and the way back here.
   *
   * When this is empty the OM7Player button falls through to the App Store,
   * which is the right answer for a song that has no bundle yet - sending
   * somebody to a download that does not exist would be worse than sending
   * them to the app.
   *
   * The URL must keep its `.om7` extension. OM7Player claims the type by
   * FILENAME EXTENSION and deliberately declares no MIME tag, so the extension
   * is the only thing Safari and Mail match on when deciding to offer the app.
   * S3 serves these as application/octet-stream so they download rather than
   * render.
   */
  om7PlayerUrl?: string
  /**
   * What Play streams: a 256 kbps AAC copy of `url`, about a tenth its size.
   * The WAV stays the download; streaming it costs a phone ~15 MB a minute.
   */
  streamUrl?: string
}

const STREAMS = "https://777records777productpageassets.s3.us-east-2.amazonaws.com/streams"

const SOUND_DOWNLOADS: Record<string, SoundDownload> = {
  prod_01KG8CPWZ9T008217JZYTM3EKW: {
    url: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/Goddess+of+Love+(feat.+Kap+G).wav",
    label: "Download Goddess Of Love",
    streamUrl: `${STREAMS}/goddess-of-love.m4a`,
    om7PlayerUrl: "",
  },
  prod_01KJAM74E83E3PEHKTZNSDEGRV: {
    url: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/Going%20Crazy.wav",
    label: "Download Gone Crazy",
    streamUrl: `${STREAMS}/gone-crazy.m4a`,
    om7PlayerUrl:
      "https://777records777productpageassets.s3.us-east-2.amazonaws.com/Gone%20Crazy.om7",
  },
  prod_01KQAK7DCK4SFVFGHXSYPHXBB1: {
    url: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/New+Deal-+master.wav",
    label: "Download New Deal",
    streamUrl: `${STREAMS}/new-deal.m4a`,
    om7PlayerUrl:
      "https://777records777productpageassets.s3.us-east-2.amazonaws.com/New%20Deal.om7",
  },
}

/**
 * Streaming copies for Site Manager releases, keyed by the manifest's audio
 * item id. The manifest has no field for one, so a release published without
 * an entry here still plays - it streams its own audio file instead.
 */
const MANIFEST_STREAMS: Record<string, string> = {
  "8db3c249-35c0-484e-b6c4-de2faf60a076": `${STREAMS}/in-time.m4a`, // In Time
}

export const getManifestStreamUrl = (audioItemId: string): string | undefined =>
  MANIFEST_STREAMS[audioItemId.toLowerCase()]

export const SOUND_PRODUCT_IDS = Object.keys(SOUND_DOWNLOADS)

export const OM7_PLAYER_URL =
  "https://apps.apple.com/us/app/om7player/id6755060481"

export const getSoundDownload = (product: {
  id?: string
  metadata?: Record<string, unknown> | null
}): SoundDownload | null => {
  if (product.id && SOUND_DOWNLOADS[product.id]) {
    return SOUND_DOWNLOADS[product.id]
  }

  if (typeof product.metadata?.download_url === "string") {
    return {
      url: product.metadata.download_url,
      label:
        typeof product.metadata.download_label === "string"
          ? product.metadata.download_label
          : "Download",
      om7PlayerUrl:
        typeof product.metadata.om7player_url === "string"
          ? product.metadata.om7player_url
          : undefined,
    }
  }

  return null
}

export const isSoundProduct = (product: {
  id?: string
  metadata?: Record<string, unknown> | null
}) => Boolean(getSoundDownload(product))

const ROTATE_LEFT_90_PRODUCT_IDS = new Set([
  "prod_01KG8CPWZ9T008217JZYTM3EKW", // Goddess of Love
  "prod_01KJAM74E83E3PEHKTZNSDEGRV", // Gone Crazy
])

export const getArtworkRotationClassName = (product: { id?: string }) =>
  product.id && ROTATE_LEFT_90_PRODUCT_IDS.has(product.id)
    ? "-rotate-90"
    : undefined
