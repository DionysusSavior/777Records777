"use client"

import { convertToLocale } from "@lib/util/money"
import { Button, Heading } from "@medusajs/ui"

import Divider from "@modules/common/components/divider"
import DiscountCode from "@modules/checkout/components/discount-code"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { HttpTypes } from "@medusajs/types"

type SummaryProps = {
  cart: HttpTypes.StoreCart & {
    promotions: HttpTypes.StorePromotion[]
  }
}

function getCheckoutStep(cart: HttpTypes.StoreCart) {
  if (!cart?.shipping_address?.address_1 || !cart.email) {
    return "address"
  } else if (cart?.shipping_methods?.length === 0) {
    return "delivery"
  } else {
    return "payment"
  }
}

const Summary = ({ cart }: SummaryProps) => {
  const step = getCheckoutStep(cart)
  const totalAmount = convertToLocale({
    amount: cart.total ?? 0,
    currency_code: cart.currency_code,
  })

  return (
    <div className="glass-panel rounded-3xl px-6 py-8 flex flex-col gap-y-6">
      <Heading level="h2" className="text-[2rem] leading-[2.75rem] holo-text">
        Summary
      </Heading>
      <DiscountCode cart={cart} />
      <Divider className="border-white/10" />
      <div className="flex items-center justify-between text-sm uppercase tracking-[0.2em] text-white/60">
        <span>Total</span>
        <span
          className="text-base font-semibold holo-text"
          data-testid="cart-total"
          data-value={cart.total || 0}
        >
          {totalAmount}
        </span>
      </div>
      <LocalizedClientLink
        href={"/checkout?step=" + step}
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
  )
}

export default Summary
