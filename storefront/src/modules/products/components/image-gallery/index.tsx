import { HttpTypes } from "@medusajs/types"
import { Container } from "@medusajs/ui"
import Image from "next/image"

type ImageGalleryProps = {
  images: HttpTypes.StoreProductImage[]
}

const isVideoUrl = (url?: string) => {
  if (!url) {
    return false
  }

  try {
    const pathname = new URL(url).pathname.toLowerCase()
    return /\.(mp4|mov|webm|ogg)$/.test(pathname)
  } catch {
    const pathname = url.split("?")[0].toLowerCase()
    return /\.(mp4|mov|webm|ogg)$/.test(pathname)
  }
}

const getVideoType = (url: string) => {
  const lower = url.split("?")[0].toLowerCase()
  if (lower.endsWith(".mp4")) return "video/mp4"
  if (lower.endsWith(".mov")) return "video/quicktime"
  if (lower.endsWith(".webm")) return "video/webm"
  if (lower.endsWith(".ogg") || lower.endsWith(".ogv")) return "video/ogg"
  return undefined
}

const ImageGallery = ({ images }: ImageGalleryProps) => {
  return (
    <div className="flex items-start relative">
      <div className="flex flex-col flex-1 small:mx-16 gap-y-4">
        {images.map((image, index) => {
          return (
            <Container
              key={image.id}
              className="relative aspect-[29/34] w-full overflow-hidden bg-ui-bg-subtle"
              id={image.id}
            >
              {!!image.url &&
                (isVideoUrl(image.url) ? (
                  <video
                    src={image.url}
                    className="absolute inset-0 h-full w-full rounded-rounded object-cover"
                    loop
                    autoPlay
                    muted
                    playsInline
                    preload="metadata"
                    controls
                    aria-label={`Product video ${index + 1}`}
                  >
                    <source src={image.url} type={getVideoType(image.url)} />
                  </video>
                ) : (
                  <Image
                    src={image.url}
                    priority={index <= 2 ? true : false}
                    className="absolute inset-0 rounded-rounded"
                    alt={`Product image ${index + 1}`}
                    fill
                    sizes="(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"
                    style={{
                      objectFit: "cover",
                    }}
                  />
                ))}
            </Container>
          )
        })}
      </div>
    </div>
  )
}

export default ImageGallery
