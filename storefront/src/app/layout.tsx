import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import Script from "next/script"
import "styles/globals.css"
import SplashScreen from "@modules/layout/components/splash-screen"
import PageViewConversion from "@modules/common/components/page-view-conversion"
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
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=AW-11321668434"
          strategy="afterInteractive"
        />
        <Script id="google-ads-tag" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'AW-11321668434');
          `}
        </Script>
      </head>
      <body className="bg-slate-950 text-slate-100">
        <PageViewConversion />
        <main className="relative">
          <SplashScreen>{props.children}</SplashScreen>
        </main>
      </body>
    </html>
  )
}
