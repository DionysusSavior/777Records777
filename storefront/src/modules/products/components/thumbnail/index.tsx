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
  mediaClassName?: string
  placeholder?: "image" | "audio"
  "data-testid"?: string
}

const Thumbnail: React.FC<ThumbnailProps> = ({
  thumbnail,
  images,
  size = "small",
  isFeatured,
  className,
  mediaClassName,
  placeholder = "image",
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
      <MediaOrPlaceholder
        mediaUrl={mediaUrl}
        size={size}
        mediaClassName={mediaClassName}
        placeholder={placeholder}
      />
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
  mediaClassName,
  placeholder,
}: Pick<ThumbnailProps, "size" | "mediaClassName" | "placeholder"> & {
  mediaUrl?: string
}) => {
  if (mediaUrl && isVideoUrl(mediaUrl)) {
    return (
      <video
        src={mediaUrl}
        className={clx(
          "absolute inset-0 h-full w-full object-cover object-center rounded-medium",
          mediaClassName
        )}
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
        className={clx("absolute inset-0 object-cover object-center", mediaClassName)}
        draggable={false}
        quality={50}
        sizes="(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"
        fill
        unoptimized={shouldBypassOptimization(mediaUrl)}
      />
    )
  }

  if (placeholder === "audio") {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/[0.08] via-transparent to-white/[0.03] text-white/70"
        aria-label="Audio artwork placeholder"
      >
        <svg
          width="42"
          height="42"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M9 18V5l10-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="16" cy="16" r="3" />
        </svg>
      </div>
    )
  }

  return (
    <div className="w-full h-full absolute inset-0 flex items-center justify-center">
      <PlaceholderImage size={size === "small" ? 16 : 24} />
    </div>
  )
}

export default Thumbnail
