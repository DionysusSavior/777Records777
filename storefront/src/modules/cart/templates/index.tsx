import ItemsTemplate from "./items"
import Summary from "./summary"
import EmptyCartMessage from "../components/empty-cart-message"
import SignInPrompt from "../components/sign-in-prompt"
import { HttpTypes } from "@medusajs/types"

const CartTemplate = ({
  cart,
  customer,
}: {
  cart: HttpTypes.StoreCart | null
  customer: HttpTypes.StoreCustomer | null
}) => {
  const hasItems = !!cart?.items?.length
  const isPreorderCart = cart?.items?.length
    ? cart.items.every((item) => {
        const preorder = item.variant?.product?.metadata?.preorder
        if (preorder === undefined) {
          return true
        }
        return preorder === true || preorder === "true"
      })
    : false
  const showSummary = Boolean(cart && cart.region && !isPreorderCart)
  const gridClass = showSummary
    ? "grid grid-cols-1 gap-10 small:grid-cols-[minmax(0,1fr)_360px]"
    : "grid grid-cols-1"

  return (
    <div className="py-12">
      <div className="content-container" data-testid="cart-container">
        {hasItems ? (
          <div className={gridClass}>
            <div className="flex flex-col gap-y-6">
              {!customer && <SignInPrompt />}
              <div className="glass-panel rounded-3xl px-6 py-8">
                <ItemsTemplate
                  cart={cart}
                  showCheckoutAction={!showSummary}
                  isPreorder={isPreorderCart}
                />
              </div>
            </div>
            {showSummary && (
              <div className="relative">
                <div className="flex flex-col gap-y-8 sticky top-12">
                  <Summary cart={cart as any} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <EmptyCartMessage />
          </div>
        )}
      </div>
    </div>
  )
}

export default CartTemplate
