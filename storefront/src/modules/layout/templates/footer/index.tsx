import { listCategories } from "@lib/data/categories"
import { listCollections } from "@lib/data/collections"
import { Text, clx } from "@medusajs/ui"

import LocalizedClientLink from "@modules/common/components/localized-client-link"

/**
 * The footer is in the layout, so it renders on every page - and both of these
 * calls reach the commerce backend for links.
 *
 * Unguarded, an unreachable backend threw here and 500'd the whole site,
 * including pages that sell nothing. The block below already collapses to
 * nothing when there are no categories or collections, so an outage lands in
 * that same empty state instead of taking the page with it.
 */
export default async function Footer() {
  const [collectionsResult, categoriesResult] = await Promise.allSettled([
    listCollections({ fields: "*products" }),
    listCategories(),
  ])

  if (collectionsResult.status === "rejected") {
    console.error(
      "footer: store links unavailable, rendering without them.",
      collectionsResult.reason instanceof Error
        ? collectionsResult.reason.message
        : collectionsResult.reason
    )
  }

  const collections =
    collectionsResult.status === "fulfilled"
      ? collectionsResult.value.collections
      : []
  const productCategories =
    categoriesResult.status === "fulfilled" ? categoriesResult.value : []
  const hasCategories = Boolean(productCategories?.length)
  const hasCollections = Boolean(collections?.length)

  return (
    <footer className="mt-auto w-full border-t border-ui-border-base">
      <div className="content-container flex flex-col w-full">
        {/* Only takes up room when there is something to put in it. This block
            held 256px of padding around a grid that is empty whenever the store
            has no categories or collections, which was most of the dead space
            under every page. */}
        {(hasCategories || hasCollections) && (
        <div className="py-16">
          <div className="text-small-regular gap-10 md:gap-x-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {productCategories && productCategories?.length > 0 && (
              <div className="flex flex-col gap-y-2">
                <span className="txt-small-plus txt-ui-fg-base">
                  Categories
                </span>
                <ul
                  className="grid grid-cols-1 gap-2"
                  data-testid="footer-categories"
                >
                  {productCategories?.slice(0, 6).map((c) => {
                    if (c.parent_category) {
                      return
                    }

                    const children =
                      c.category_children?.map((child) => ({
                        name: child.name,
                        handle: child.handle,
                        id: child.id,
                      })) || null

                    return (
                      <li
                        className="flex flex-col gap-2 text-ui-fg-subtle txt-small"
                        key={c.id}
                      >
                        <LocalizedClientLink
                          className={clx(
                            "hover:text-ui-fg-base",
                            children && "txt-small-plus"
                          )}
                          href={`/categories/${c.handle}`}
                          data-testid="category-link"
                        >
                          {c.name}
                        </LocalizedClientLink>
                        {children && (
                          <ul className="grid grid-cols-1 ml-3 gap-2">
                            {children &&
                              children.map((child) => (
                                <li key={child.id}>
                                  <LocalizedClientLink
                                    className="hover:text-ui-fg-base"
                                    href={`/categories/${child.handle}`}
                                    data-testid="category-link"
                                  >
                                    {child.name}
                                  </LocalizedClientLink>
                                </li>
                              ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {collections && collections.length > 0 && (
              <div className="flex flex-col gap-y-2">
                <span className="txt-small-plus txt-ui-fg-base">
                  Collections
                </span>
                <ul
                  className={clx(
                    "grid grid-cols-1 gap-2 text-ui-fg-subtle txt-small",
                    {
                      "grid-cols-2": (collections?.length || 0) > 3,
                    }
                  )}
                >
                  {collections?.slice(0, 6).map((c) => (
                    <li key={c.id}>
                      <LocalizedClientLink
                        className="hover:text-ui-fg-base"
                        href={`/collections/${c.handle}`}
                      >
                        {c.title}
                      </LocalizedClientLink>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        )}
        <div className="flex w-full justify-between py-8 text-ui-fg-muted">
          <Text className="txt-compact-small">
            © {new Date().getFullYear()} 777Records777 Studio. All rights reserved.
          </Text>
        </div>
      </div>
    </footer>
  )
}
