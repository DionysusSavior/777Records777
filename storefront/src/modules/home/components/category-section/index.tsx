import { Text } from "@medusajs/ui"

import { listProductsWithSort } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import InteractiveLink from "@modules/common/components/interactive-link"
import ProductPreview from "@modules/products/components/product-preview"

export default async function CategorySection({
  title,
  countryCode,
  productsIds,
  viewAllHref,
}: {
  title: string
  countryCode: string
  productsIds: string[]
  viewAllHref: string
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
        <ul
          className="grid grid-cols-2 small:grid-cols-3 medium:grid-cols-4 gap-x-6 gap-y-8"
          data-testid="products-list"
        >
          {products.map((product) => (
            <li key={product.id}>
              <ProductPreview product={product} region={region} />
            </li>
          ))}
        </ul>
      ) : (
        <Text className="text-ui-fg-subtle">Coming soon.</Text>
      )}
    </section>
  )
}
