import { Metadata } from "next"
import { Heading, Text } from "@medusajs/ui"

export const metadata: Metadata = {
  title: "Customer Service",
  description: "Get help from 777Records777 Studio.",
}

export default function CustomerServicePage() {
  return (
    <div className="py-12 min-h-[calc(100vh-64px)]">
      <div className="content-container flex justify-center">
        <div className="glass-panel rounded-3xl px-8 py-10 w-full max-w-2xl flex flex-col gap-6">
          <Heading level="h1" className="text-3xl-regular holo-text">
            Customer Service
          </Heading>
          <Text className="text-base-regular text-white/70">
            For any questions or support, email us at{" "}
            <a
              href="mailto:777Records777@proton.me"
              className="text-white underline"
            >
              777Records777@proton.me
            </a>
            .
          </Text>
        </div>
      </div>
    </div>
  )
}
