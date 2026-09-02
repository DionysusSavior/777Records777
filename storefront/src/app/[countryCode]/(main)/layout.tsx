import { Metadata } from "next"

import { listCartOptions, retrieveCart } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/data/customer"
import { getBaseURL } from "@lib/util/env"
import { StoreCartShippingOption } from "@medusajs/types"
import CartMismatchBanner from "@modules/layout/components/cart-mismatch-banner"
import Footer from "@modules/layout/templates/footer"
import Nav from "@modules/layout/templates/nav"
import FreeShippingPriceNudge from "@modules/shipping/components/free-shipping-price-nudge"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

/**
 * THIS LAYOUT WRAPS EVERY PAGE, SO ITS FAILURES ARE EVERY PAGE'S.
 *
 * All three calls below reach the commerce backend, and all three feed
 * decoration: a cart-mismatch banner, a free-shipping nudge, and the cart
 * count in the nav. None of them is why a visitor came. Yet an unreachable
 * backend threw here and returned 500 for the entire site - artist pages and
 * free downloads included, which need no backend at all.
 *
 * Every one degrades to nothing. A signed-out-looking nav and no banners is a
 * fair description of an outage; a 500 on a page that sells nothing is not.
 */
async function orNull<T>(work: Promise<T>, what: string): Promise<T | null> {
  try {
    return await work
  } catch (error) {
    console.error(
      `layout: ${what} unavailable, rendering without it.`,
      error instanceof Error ? error.message : error
    )
    return null
  }
}

export default async function PageLayout(props: { children: React.ReactNode }) {
  const customer = await orNull(retrieveCustomer(), "customer")
  const cart = await orNull(retrieveCart(), "cart")
  let shippingOptions: StoreCartShippingOption[] = []

  if (cart) {
    const options = await orNull(listCartOptions(), "shipping options")
    shippingOptions = options?.shipping_options ?? []
  }

  return (
    /* A column at least as tall as the window: whatever the page is, the
       footer ends up at the bottom of it rather than partway down. */
    <div className="flex min-h-[100dvh] flex-col">
      <Nav />
      {customer && cart && (
        <CartMismatchBanner customer={customer} cart={cart} />
      )}

      {cart && (
        <FreeShippingPriceNudge
          variant="popup"
          cart={cart}
          shippingOptions={shippingOptions}
        />
      )}
      {props.children}
      <Footer />
    </div>
  )
}
