import repeat from "@lib/util/repeat"
import { HttpTypes } from "@medusajs/types"
import { Button, Heading } from "@medusajs/ui"

import Item from "@modules/cart/components/item"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

type ItemsTemplateProps = {
  cart?: HttpTypes.StoreCart
  showCheckoutAction?: boolean
  isPreorder?: boolean
}

const getCheckoutStep = (
  cart?: HttpTypes.StoreCart,
  isPreorder?: boolean
) => {
  if (isPreorder) {
    return "address"
  }
  if (!cart?.shipping_address?.address_1 || !cart.email) {
    return "address"
  } else if (cart?.shipping_methods?.length === 0) {
    return "delivery"
  } else {
    return "payment"
  }
}

const ItemsTemplate = ({
  cart,
  showCheckoutAction = false,
  isPreorder = false,
}: ItemsTemplateProps) => {
  const items = cart?.items
  const step = getCheckoutStep(cart, isPreorder)

  return (
    <div>
      <div className="flex items-center justify-between">
        <Heading className="text-[2rem] leading-[2.75rem] holo-text">
          Cart
        </Heading>
      </div>
      <div className="mt-6 flex flex-col gap-4">
        {items
          ? items
              .sort((a, b) => {
                return (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
              })
              .map((item) => {
                return (
                  <Item
                    key={item.id}
                    item={item}
                    currencyCode={cart?.currency_code}
                  />
                )
              })
          : repeat(3).map((i) => {
              return (
                <div
                  key={i}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-20 w-20 rounded-xl bg-white/10 animate-pulse" />
                      <div className="flex flex-col gap-2">
                        <div className="h-4 w-40 bg-white/10 animate-pulse" />
                        <div className="h-3 w-28 bg-white/10 animate-pulse" />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-16 rounded-md bg-white/10 animate-pulse" />
                      <div className="h-4 w-10 rounded-md bg-white/10 animate-pulse" />
                    </div>
                  </div>
                </div>
              )
            })}
      </div>
      {showCheckoutAction && cart && (
        <div className="pt-6">
          <LocalizedClientLink
            href={`/checkout?step=${step}`}
            data-testid="checkout-button"
          >
            <Button
              variant="transparent"
              className="w-full h-12 bg-transparent border border-white/30 text-white hover:bg-white/10"
            >
              <span className="holo-text">Go to checkout</span>
            </Button>
          </LocalizedClientLink>
        </div>
      )}
    </div>
  )
}

export default ItemsTemplate
