import { Text } from "@medusajs/ui"
import { listProducts } from "@lib/data/products"
import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Thumbnail from "../thumbnail"
import PreviewPrice from "./price"

export default async function ProductPreview({
  product,
  isFeatured,
  region,
}: {
  product: HttpTypes.StoreProduct
  isFeatured?: boolean
  region: HttpTypes.StoreRegion
}) {
  if (!product?.handle) {
    return null
  }

  const isVideo = (url?: string | null) =>
    !!url && /\.(mp4|mov|webm|ogg)$/i.test((url.split("?")[0] as string) || "")

  const nonVideoImages =
    product.images?.filter((img) => !isVideo(img.url)) ?? product.images ?? []
  const videos = product.images?.filter((img) => isVideo(img.url)) ?? []
  const preferredImages =
    nonVideoImages.length > 0 ? nonVideoImages : videos

  const isPreorder =
    product.variants?.some(
      (v) => v.allow_backorder === true || v.manage_inventory === false
    ) ?? false

  // const pricedProduct = await listProducts({
  //   regionId: region.id,
  //   queryParams: { id: [product.id!] },
  // }).then(({ response }) => response.products[0])

  // if (!pricedProduct) {
  //   return null
  // }

  const { cheapestPrice } = getProductPrice({
    product,
  })

  return (
    <LocalizedClientLink href={`/products/${product.handle}`} className="group">
      <div data-testid="product-wrapper">
        <Thumbnail
          thumbnail={product.thumbnail}
          images={preferredImages}
          size="full"
          isFeatured={isFeatured}
        />
        <div className="flex txt-compact-medium mt-4 justify-between">
          <Text className="text-ui-fg-subtle" data-testid="product-title">
            {product.title}
          </Text>
          <div className="flex items-center gap-x-2">
            {isPreorder && (
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-wide text-white">
                Preorder
              </span>
            )}
            {cheapestPrice && <PreviewPrice price={cheapestPrice} />}
          </div>
        </div>
      </div>
    </LocalizedClientLink>
  )
}
