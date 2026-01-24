import { Heading } from "@medusajs/ui"

import ItemsPreviewTemplate from "@modules/cart/templates/preview"
import DiscountCode from "@modules/checkout/components/discount-code"
import CartTotals from "@modules/common/components/cart-totals"
import Divider from "@modules/common/components/divider"

const CheckoutSummary = ({ cart }: { cart: any }) => {
  return (
    <div className="sticky top-0 flex flex-col-reverse small:flex-col gap-y-8 py-8 small:py-0 ">
      <div className="glass-panel rounded-3xl px-6 py-8 flex flex-col gap-y-6">
        <Divider className="my-6 small:hidden border-white/10" />
        <Heading
          level="h2"
          className="flex flex-row text-3xl-regular items-baseline holo-text"
        >
          In your Cart
        </Heading>
        <Divider className="my-6 border-white/10" />
        <CartTotals totals={cart} />
        <ItemsPreviewTemplate cart={cart} />
        <div className="my-6">
          <DiscountCode cart={cart} />
        </div>
      </div>
    </div>
  )
}

export default CheckoutSummary
