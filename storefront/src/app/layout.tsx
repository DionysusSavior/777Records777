import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import "styles/globals.css"
import SplashScreen from "@modules/layout/components/splash-screen"
import "../styles/animations.css"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
  openGraph: {
    title: "777Records777 Studio",
    description: "Sound, style, and stories from 777Records777 Studio.",
    images: [
      {
        url: "https://777records777.studio/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "777Records777 Studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "777Records777 Studio",
    description: "Sound, style, and stories from 777Records777 Studio.",
    images: ["https://777records777.studio/twitter-image.jpg"],
  },
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="dark" className="dark">
      <body className="bg-slate-950 text-slate-100">
        <main className="relative">
          <SplashScreen>{props.children}</SplashScreen>
        </main>
      </body>
    </html>
  )
}
