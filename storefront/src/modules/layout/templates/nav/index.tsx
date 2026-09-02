import { Suspense } from "react"

import { listRegions } from "@lib/data/regions"
import { listLocales } from "@lib/data/locales"
import { getLocale } from "@lib/data/locale-actions"
import { StoreRegion } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import SideMenu from "@modules/layout/components/side-menu"

/**
 * THE NAV IS IN THE ROOT LAYOUT, SO ITS FAILURES ARE THE WHOLE SITE'S.
 *
 * These three calls reach the commerce backend for a region list, a locale
 * list and the current locale - all of which decorate a menu. `medusaError`
 * rethrows on any transport failure, and because this component renders on
 * every route, an unreachable backend used to turn every page into a 500,
 * including artist pages and free downloads that sell nothing.
 *
 * The menu degrades instead. Empty lists give a region and language switcher
 * with nothing to switch to, which is a correct description of the situation
 * during an outage, and every other part of the site keeps working.
 *
 * Settled individually rather than with one Promise.all: that helper rejects
 * as a whole, so a locale lookup failing would have discarded a perfectly good
 * region list alongside it.
 */
export default async function Nav() {
  const [regionsResult, localesResult, localeResult] = await Promise.allSettled([
    listRegions().then((regions: StoreRegion[]) => regions),
    listLocales(),
    getLocale(),
  ])

  if (regionsResult.status === "rejected") {
    console.error(
      "nav: region list unavailable, rendering without it.",
      regionsResult.reason instanceof Error
        ? regionsResult.reason.message
        : regionsResult.reason
    )
  }

  const regions = regionsResult.status === "fulfilled" ? regionsResult.value : []
  const locales = localesResult.status === "fulfilled" ? localesResult.value : []
  const currentLocale =
    localeResult.status === "fulfilled" ? localeResult.value : null

  return (
    <div className="sticky top-0 inset-x-0 z-50 group">
      <header className="relative h-16 mx-auto border-b border-white/10 duration-200 bg-[rgba(5,5,5,0.72)] backdrop-blur-xl shadow-[0_1px_12px_rgba(0,0,0,0.6)]">
        <nav className="content-container txt-xsmall-plus flex items-center justify-between w-full h-full text-small-regular text-stone-100">
          <div className="flex-1 basis-0 h-full flex items-center">
            <div className="h-full">
              <SideMenu regions={regions} locales={locales} currentLocale={currentLocale} />
            </div>
          </div>

          <div className="flex items-center h-full">
            <LocalizedClientLink
              href="/"
              className="txt-compact-xlarge-plus uppercase holo-text hover:opacity-90 transition-opacity"
              data-testid="nav-store-link"
            >
              777Records777 Studio
            </LocalizedClientLink>
          </div>

          <div className="flex items-center gap-x-6 h-full flex-1 basis-0 justify-end">
            <div className="hidden small:flex items-center gap-x-6 h-full">
              <LocalizedClientLink
                className="holo-text hover:opacity-80 transition-opacity"
                href="/account"
                data-testid="nav-account-link"
              >
                Account
              </LocalizedClientLink>
            </div>
            <Suspense
              fallback={
                <LocalizedClientLink
                  className="holo-text hover:opacity-80 transition-opacity flex gap-2"
                  href="/cart"
                  data-testid="nav-cart-link"
                >
                  Cart (0)
                </LocalizedClientLink>
              }
            >
              <CartButton />
            </Suspense>
          </div>
        </nav>
      </header>
    </div>
  )
}
