import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import "styles/globals.css"
import SplashScreen from "@modules/layout/components/splash-screen"
import "../styles/animations.css"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="light">
      <body>
        <main className="relative">
          <SplashScreen>{props.children}</SplashScreen>
        </main>
      </body>
    </html>
  )
}
