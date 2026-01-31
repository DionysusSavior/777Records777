import { Container, clx } from "@medusajs/ui"
import Image from "next/image"
import React from "react"

import PlaceholderImage from "@modules/common/icons/placeholder-image"

type ThumbnailProps = {
  thumbnail?: string | null
  // TODO: Fix image typings
  images?: any[] | null
  size?: "small" | "medium" | "large" | "full" | "square"
  isFeatured?: boolean
  className?: string
  "data-testid"?: string
}

const Thumbnail: React.FC<ThumbnailProps> = ({
  thumbnail,
  images,
  size = "small",
  isFeatured,
  className,
  "data-testid": dataTestid,
}) => {
  const mediaCandidates = [
    thumbnail,
    ...(images?.map((i) => i?.url).filter(Boolean) ?? []),
  ].filter(Boolean) as string[]
  const mediaUrl = mediaCandidates[0]

  return (
    <Container
      className={clx(
        "relative w-full overflow-hidden p-4 bg-ui-bg-subtle shadow-elevation-card-rest rounded-large group-hover:shadow-elevation-card-hover transition-shadow ease-in-out duration-150",
        className,
        {
          "aspect-[11/14]": isFeatured,
          "aspect-[9/16]": !isFeatured && size !== "square",
          "aspect-[1/1]": size === "square",
          "w-[180px]": size === "small",
          "w-[290px]": size === "medium",
          "w-[440px]": size === "large",
          "w-full": size === "full",
        }
      )}
      data-testid={dataTestid}
    >
      <MediaOrPlaceholder mediaUrl={mediaUrl} size={size} />
    </Container>
  )
}

const isVideoUrl = (url?: string) => {
  if (!url) {
    return false
  }

  const path = url.split("?")[0].toLowerCase()
  return /\.(mp4|mov|webm|ogg)$/.test(path)
}

const shouldBypassOptimization = (url?: string) => {
  if (!url) {
    return false
  }

  return url.includes(
    "777records777productpageassets.s3.us-east-2.amazonaws.com"
  )
}

const MediaOrPlaceholder = ({
  mediaUrl,
  size,
}: Pick<ThumbnailProps, "size"> & { mediaUrl?: string }) => {
  if (mediaUrl && isVideoUrl(mediaUrl)) {
    return (
      <video
        src={mediaUrl}
        className="absolute inset-0 h-full w-full object-cover object-center rounded-medium"
        muted
        loop
        playsInline
        preload="metadata"
        autoPlay
        controls={false}
        aria-label="Product video preview"
      />
    )
  }

  if (mediaUrl) {
    return (
      <Image
        src={mediaUrl}
        alt="Thumbnail"
        className="absolute inset-0 object-cover object-center"
        draggable={false}
        quality={50}
        sizes="(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"
        fill
        unoptimized={shouldBypassOptimization(mediaUrl)}
      />
    )
  }

  return (
    <div className="w-full h-full absolute inset-0 flex items-center justify-center">
      <PlaceholderImage size={size === "small" ? 16 : 24} />
    </div>
  )
}

export default Thumbnail
