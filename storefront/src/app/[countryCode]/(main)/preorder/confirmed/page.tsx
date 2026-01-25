import { Metadata } from "next"
import { Button, Heading, Text } from "@medusajs/ui"

import LocalizedClientLink from "@modules/common/components/localized-client-link"

export const metadata: Metadata = {
  title: "Preorder Confirmed",
}

export default function PreorderConfirmedPage() {
  return (
    <div className="py-12 min-h-[calc(100vh-64px)]">
      <div className="content-container flex justify-center">
        <div className="glass-panel rounded-3xl px-8 py-10 w-full max-w-2xl flex flex-col gap-6">
          <Heading level="h1" className="text-3xl-regular holo-text">
            Preorder received
          </Heading>
          <Text className="text-base-regular text-white/70">
            Thanks for your preorder. We will email you when this release is
            ready to ship.
          </Text>
          <div>
            <LocalizedClientLink href="/">
              <Button
                variant="transparent"
                className="h-11 bg-transparent border border-white/30 text-white hover:bg-white/10"
              >
                Continue shopping
              </Button>
            </LocalizedClientLink>
          </div>
        </div>
      </div>
    </div>
  )
}
