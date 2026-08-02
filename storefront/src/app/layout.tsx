import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import Script from "next/script"
import "styles/globals.css"

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

/**
 * `dark` on <html> flips the @medusajs/ui colour tokens. Without it every
 * component styled with text-ui-fg-* or border-ui-border-* keeps its
 * light-theme value and vanishes against the black page.
 *
 * <body> carries no colour classes on purpose: a utility class there beats the
 * `background` rule in globals.css, which is how the page stayed off-white
 * after the theme was switched to black.
 */
export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <Script id="gtm" strategy="beforeInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-WVRWRWCJ');`}
        </Script>
      </head>
      <body>
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-WVRWRWCJ"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}
