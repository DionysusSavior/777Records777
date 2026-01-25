import { retrieveCart } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/data/customer"
import PaymentWrapper from "@modules/checkout/components/payment-wrapper"
import CheckoutForm from "@modules/checkout/templates/checkout-form"
import CheckoutSummary from "@modules/checkout/templates/checkout-summary"
import { Metadata } from "next"
import { notFound } from "next/navigation"

export const metadata: Metadata = {
  title: "Checkout",
}

export default async function Checkout() {
  const cart = await retrieveCart()

  if (!cart) {
    return notFound()
  }

  const customer = await retrieveCustomer()
  const isPreorderCart = cart.items?.length
    ? cart.items.every((item) => {
        const preorder = item.variant?.product?.metadata?.preorder
        if (preorder === undefined) {
          return true
        }
        return preorder === true || preorder === "true"
      })
    : false

  return (
    <div className="grid grid-cols-1 small:grid-cols-[1fr_416px] content-container gap-x-40 py-12">
      <PaymentWrapper cart={cart}>
        <CheckoutForm
          cart={cart}
          customer={customer}
          isPreorder={isPreorderCart}
        />
      </PaymentWrapper>
      <CheckoutSummary cart={cart} />
    </div>
  )
}
