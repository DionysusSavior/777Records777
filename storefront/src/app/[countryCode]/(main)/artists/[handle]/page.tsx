import { Metadata } from "next"
import { notFound } from "next/navigation"
import { Button, Text } from "@medusajs/ui"

import ArtistHero from "@modules/artists/components/artist-hero"
import CategorySection from "@modules/home/components/category-section"
import { ARTISTS, getArtist } from "@lib/artists"
import { OM7_PLAYER_URL } from "@lib/sounds"

type Props = {
  params: Promise<{ countryCode: string; handle: string }>
}

// No generateStaticParams here, deliberately. Listing the handles marks the
// route as statically generated, and the shelves below resolve the region from
// the request cookie, which a static render is not allowed to read. The whole
// page then fails with DYNAMIC_SERVER_USAGE. It renders per request like every
// other route in this app.

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { handle } = await props.params
  const artist = getArtist(handle)

  if (!artist) {
    return { title: "777Records777 Studio" }
  }

  return {
    title: `${artist.name} | 777Records777 Studio`,
    description: `${artist.name} — ${artist.tagline}.`,
  }
}

/**
 * One artist, three shelves.
 *
 * The sections are the same three the home page used to carry; the only thing
 * that changed is that each one is now filtered to this artist's ids. A shelf
 * with nothing on it still renders — "Coming soon" is a truer answer than a
 * missing section, which just looks like the page failed to load.
 */
export default async function ArtistPage(props: Props) {
  const { countryCode, handle } = await props.params
  const artist = getArtist(handle)

  if (!artist) {
    notFound()
  }

  return (
    <>
      <ArtistHero artist={artist} />

      <CategorySection
        title="Sounds"
        countryCode={countryCode}
        productsIds={artist.soundIds}
        viewAllHref="/sounds"
      >
        <div className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <Text className="txt-medium">Get the OM7Player app</Text>
          <Text className="text-ui-fg-subtle txt-small">
            Listen to 777Records777 sounds on the go with the OM7Player app.
          </Text>
          <Button asChild variant="secondary">
            <a href={OM7_PLAYER_URL} target="_blank" rel="noreferrer noopener">
              Download OM7Player
            </a>
          </Button>
        </div>
      </CategorySection>

      <CategorySection
        title="Uniforms"
        countryCode={countryCode}
        productsIds={artist.uniformIds}
        viewAllHref="/store"
      />

      <CategorySection
        title="Amulets"
        countryCode={countryCode}
        productsIds={artist.amuletIds}
        viewAllHref="/amulets"
      />
    </>
  )
}
