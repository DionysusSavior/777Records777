import { Metadata } from "next"

import CategorySection from "@modules/home/components/category-section"
import { UNIFORM_PRODUCT_IDS } from "@lib/uniforms"
import { SOUND_PRODUCT_IDS } from "@lib/sounds"

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

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const params = await props.params

  const { countryCode } = params

  return (
    <>
      <CategorySection
        title="Uniforms"
        countryCode={countryCode}
        productsIds={UNIFORM_PRODUCT_IDS}
        viewAllHref="/store"
      />
      <CategorySection
        title="Sounds"
        countryCode={countryCode}
        productsIds={SOUND_PRODUCT_IDS}
        viewAllHref="/sounds"
      />
      <CategorySection
        title="Amulets"
        countryCode={countryCode}
        productsIds={[]}
        viewAllHref="/amulets"
      />
    </>
  )
}
