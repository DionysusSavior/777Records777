type SoundDownload = {
  url: string
  label: string
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
    om7PlayerUrl: "",
  },
  prod_01KQAK7DCK4SFVFGHXSYPHXBB1: {
    url: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/New+Deal-+master.wav",
    label: "Download New Deal",
    om7PlayerUrl: "",
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
