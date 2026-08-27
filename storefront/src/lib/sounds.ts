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
}

const SOUND_DOWNLOADS: Record<string, SoundDownload> = {
  prod_01KG8CPWZ9T008217JZYTM3EKW: {
    url: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/Goddess+of+Love+(feat.+Kap+G).wav",
    label: "Download Goddess Of Love",
    om7PlayerUrl: "",
  },
  prod_01KJAM74E83E3PEHKTZNSDEGRV: {
    url: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/Going%20Crazy.wav",
    label: "Download Gone Crazy",
    om7PlayerUrl:
      "https://777records777productpageassets.s3.us-east-2.amazonaws.com/Gone%20Crazy.om7",
  },
  prod_01KQAK7DCK4SFVFGHXSYPHXBB1: {
    url: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/New+Deal-+master.wav",
    label: "Download New Deal",
    om7PlayerUrl:
      "https://777records777productpageassets.s3.us-east-2.amazonaws.com/New%20Deal.om7",
  },
}

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
