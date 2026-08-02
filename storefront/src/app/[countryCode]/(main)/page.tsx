import { Metadata } from "next"

import ArtistPanels from "@modules/home/components/artist-panels"
import { ARTISTS } from "@lib/artists"

export const metadata: Metadata = {
  title: "777Records777 Studio",
  description:
    "Sound, style, and stories from 777Records777 Studio.",
  openGraph: {
    title: "777Records777 Studio",
    description:
      "Sound, style, and stories from 777Records777 Studio.",
    images: [
      {
        // Use absolute URL so link previews don't break if NEXT_PUBLIC_BASE_URL is missing
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
    description:
      "Sound, style, and stories from 777Records777 Studio.",
    images: ["https://777records777.studio/twitter-image.jpg"],
  },
}

/**
 * The roster, and nothing else.
 *
 * Sounds, Uniforms and Amulets used to be three rails on this page, which made
 * the first thing anyone met a shelf. They now sit one click in, behind
 * whichever artist you picked, so the door to the label is the people making
 * the work rather than the stock.
 */
export default async function Home() {
  return <ArtistPanels artists={ARTISTS} />
}
