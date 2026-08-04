import Image from "next/image"

import { listProductsWithSort } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import ProductActions from "@modules/products/components/product-actions"
import ProductTabs from "@modules/products/components/product-tabs"

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
  const region = await getRegion(countryCode)
  if (!region || productIds.length === 0) {
    return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
  }

  const {
    response: { products },
  } = await listProductsWithSort({
    page: 1,
    queryParams: { limit: 12, id: productIds },
    sortBy: "created_at",
    countryCode,
  })

  if (products.length === 0) {
    return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
  }

  return (
    <div className="flex flex-col gap-10">
      {products.map((product) => {
        const art = product.thumbnail ?? product.images?.[0]?.url ?? null

        return (
          <div
            key={product.id}
            className="grid grid-cols-1 gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 small:grid-cols-2 small:gap-10 small:p-6"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black/60">
              {art && (
                <Image
                  src={art}
                  alt={product.title}
                  fill
                  sizes="(min-width: 1024px) 45vw, 100vw"
                  className="object-cover"
                />
              )}
            </div>

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
