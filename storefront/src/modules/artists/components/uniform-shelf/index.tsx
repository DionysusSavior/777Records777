import { listProductsWithSort } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import ProductActions from "@modules/products/components/product-actions"
import ProductTabs from "@modules/products/components/product-tabs"
import Thumbnail from "@modules/products/components/thumbnail"

/**
 * The merch, bought where it is seen.
 *
 * Same argument as the sounds: the product page was a detour. Size and Add to
 * cart come from the real product page components rather than reimplemented
 * ones, so the named sizes, the variant logic and the inventory checks stay in
 * exactly one place and cannot drift apart.
 *
 * Product Information and Shipping & Returns sit to the right as the same
 * accordion the product page uses, closed by default. Anyone buying a shirt
 * they have already decided on should not have to scroll past return policy to
 * reach the button.
 */
export default async function UniformShelf({
  countryCode,
  productIds,
}: {
  countryCode: string
  productIds: string[]
}) {
  /**
   * A shelf that cannot reach the backend says "Coming soon", it does not
   * take the page down with it.
   *
   * Both calls below throw when the commerce backend is unreachable, and this
   * component renders inside the artist page - so an outage used to 500 a page
   * whose reason for existing is a free download that needs no backend at all.
   * The empty state already existed for the case where an artist has no
   * products; an unreachable backend is the same thing from a visitor's point
   * of view, so it lands in the same place rather than in a new one.
   */
  let products: Awaited<ReturnType<typeof listProductsWithSort>>["response"]["products"] = []
  // Declared out here because the markup below needs it too - ProductActions
  // takes the region. Scoping it to the try block compiled but left the JSX
  // referencing a name that no longer existed.
  let region: Awaited<ReturnType<typeof getRegion>> = undefined
  try {
    region = await getRegion(countryCode)
    if (!region || productIds.length === 0) {
      return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
    }

    const result = await listProductsWithSort({
      page: 1,
      queryParams: { limit: 12, id: productIds },
      sortBy: "created_at",
      countryCode,
    })
    products = result.response.products
  } catch (error) {
    console.error(
      "shelf: products unavailable, rendering the empty state.",
      error instanceof Error ? error.message : error
    )
    return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
  }

  if (products.length === 0) {
    return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
  }

  return (
    <div className="flex flex-col gap-10">
      {products.map((product) => {
        return (
          <div
            key={product.id}
            className="grid grid-cols-1 gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 small:grid-cols-2 small:gap-10 small:p-6"
          >
            {/* Thumbnail rather than an Image: it gathers the thumbnail and
                every image, prefers whichever exists, and falls back to a
                placeholder. Selecting the media by hand is what made these
                shirts render as a price with nothing above it — the fields
                came back empty and the guard drew nothing at all. */}
            <Thumbnail thumbnail={product.thumbnail} images={product.images} size="square" isFeatured />

            <div className="flex flex-col">
              <h3 className="text-xl font-bold text-white">{product.title}</h3>
              {product.subtitle && <p className="mt-1 text-sm text-white/50">{product.subtitle}</p>}

              <div className="mt-4">
                {/* embedded: this page shows several products, so this copy
                    must not claim the URL's v_id or raise a sticky bar. */}
                <ProductActions product={product} region={region} embedded />
              </div>

              <div className="mt-6">
                <ProductTabs product={product} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
