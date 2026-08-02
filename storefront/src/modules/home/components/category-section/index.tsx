import { Text } from "@medusajs/ui"

import { listProductsWithSort } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import InteractiveLink from "@modules/common/components/interactive-link"
import ProductPreview from "@modules/products/components/product-preview"
import ScrollRail from "@modules/common/components/scroll-rail"

export default async function CategorySection({
  title,
  countryCode,
  productsIds,
  viewAllHref,
  children,
}: {
  title: string
  countryCode: string
  productsIds: string[]
  viewAllHref: string
  children?: React.ReactNode
}) {
  const region = await getRegion(countryCode)

  if (!region) {
    return null
  }

  let products: Awaited<
    ReturnType<typeof listProductsWithSort>
  >["response"]["products"] = []

  if (productsIds.length > 0) {
    const queryParams: { limit: number; id: string[] } = {
      limit: 12,
      id: productsIds,
    }

    const {
      response: { products: fetchedProducts },
    } = await listProductsWithSort({
      page: 1,
      queryParams,
      sortBy: "created_at",
      countryCode,
    })
    products = fetchedProducts
  }

  return (
    <section className="content-container py-12 small:py-24 border-t border-ui-border-base">
      <div className="flex justify-between items-center mb-8">
        <Text className="txt-xlarge">{title}</Text>
        <InteractiveLink href={viewAllHref}>View all</InteractiveLink>
      </div>
      {products.length > 0 ? (
        // A rail rather than a grid: a record label's shelf reads as something
        // you move along, and it keeps every section the same height however
        // many products are in it.
        <ScrollRail>
          {products.map((product) => (
            <ProductPreview key={product.id} product={product} region={region} />
          ))}
        </ScrollRail>
      ) : (
        <Text className="text-ui-fg-subtle">Coming soon.</Text>
      )}
      {children}
    </section>
  )
}
