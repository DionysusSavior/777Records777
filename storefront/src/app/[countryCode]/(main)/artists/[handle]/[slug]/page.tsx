import { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"

import { ManifestRelease } from "@modules/artists/components/sound-shelf"
import { openHrefFor } from "@lib/open-in-om7"
import { SoundPlayerProvider } from "@modules/artists/components/sound-player/context"
import { getArtist, type Artist } from "@lib/artists"
import { releaseSlugs } from "@lib/release-slug"
import {
  getSiteManagerShelf,
  type SiteManagerManifestItem,
  type SiteManagerManifestRelease,
} from "@lib/site-manager-manifest"

type Props = {
  params: Promise<{ countryCode: string; handle: string; slug: string }>
}

// No generateStaticParams, for the reason the artist page gives: the shelf
// components resolve the region from the request cookie, which a static render
// may not read. This page renders per request like every other route here.

/**
 * Find the release this address names.
 *
 * The slug is derived rather than stored, so resolution is: take the releases
 * the page would show, derive all their addresses together, and look this one
 * up. Together matters - the rule that settles a collision between two
 * same-titled releases can only be applied to the whole set.
 */
async function findRelease(artist: Artist, slug: string): Promise<{
  release: SiteManagerManifestRelease
  items: SiteManagerManifestItem[]
} | null> {
  const shelf = await getSiteManagerShelf(artist.manifestUrl)
  const releases = shelf.flatMap((entry) =>
    entry.kind === "release" ? [{ release: entry.release, items: entry.items }] : []
  )
  const slugs = releaseSlugs(
    releases.map((entry) => entry.release),
    artist.name
  )
  return releases.find((entry) => slugs.get(entry.release.id) === slug) ?? null
}

/**
 * The preview card, which is most of the point of this page existing.
 *
 * A link to the artist page gave every song the same card, so a post about one
 * song looked like a post about any other. Here the card is the release's own
 * artwork when it has one.
 *
 * When it has none the card is bare black - Dion's call, asked and answered.
 * The alternative was black with the title set on it, and a plain black
 * rectangle does risk reading as an image that failed to load. It is a
 * deliberate choice, not an oversight, and it is one file to change if the
 * feeds say otherwise.
 */
const cardFor = (
  release: SiteManagerManifestRelease,
  items: SiteManagerManifestItem[]
): string => {
  const artwork = release.artwork
    ? items.find((item) => item.id === release.artwork && item.kind === "image")
    : undefined
  return artwork?.url ?? "/og-black.png"
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { handle, slug } = await props.params
  const artist = getArtist(handle)
  if (!artist) return { title: "777Records777 Studio" }

  const found = await findRelease(artist, slug)
  // A metadata call for an address that resolves to nothing still has to
  // return something; the page below sends the visitor to the artist.
  if (!found) {
    return {
      title: `${artist.name} | 777Records777 Studio`,
      description: `${artist.name} — ${artist.tagline}.`,
    }
  }

  const title = `${found.release.title} — ${artist.name}`
  const description = `${found.release.title} by ${artist.name}. Free to download, straight from ${artist.name}'s own site.`
  return {
    title: `${title} | 777Records777 Studio`,
    description,
    openGraph: {
      title,
      description,
      type: "music.song",
      images: [{ url: cardFor(found.release, found.items), width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [cardFor(found.release, found.items)],
    },
  }
}

/**
 * One release, with an address of its own.
 *
 * WHY THIS PAGE EXISTS. Posting a song meant posting the artist page, and
 * every song then carried the same preview card. The link is most of what a
 * reader sees in a feed, so a song that looks like every other song is a post
 * that says nothing. This page gives each release a URL whose card is its own
 * artwork and whose title is its own title.
 *
 * AN ADDRESS THAT RESOLVES TO NOTHING GOES TO THE ARTIST, NOT TO A 404. A
 * removed release, a link a platform truncated, a typo - the person who lands
 * on it is not the artist, who will never know, but somebody who clicked a
 * link in a post. The artist's page is true, nearby, and costs one line.
 *
 * WHAT IT DRAWS IS THE SHELF'S OWN COMPONENT, so the two pages cannot
 * disagree about which file is the download or whether a priced release shows
 * a Buy button instead of a free copy of the same song.
 */
export default async function ReleasePage(props: Props) {
  const { countryCode, handle, slug } = await props.params
  const artist = getArtist(handle)

  if (!artist) {
    notFound()
  }

  const found = await findRelease(artist, slug)
  if (!found) {
    redirect(`/${countryCode}/artists/${artist.handle}`)
  }

  return (
    <SoundPlayerProvider accent={artist.glow} artistName={artist.name}>
      <div className="content-container py-12 small:py-20">
        <Link
          href={`/${countryCode}/artists/${artist.handle}`}
          className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50 transition hover:text-white"
        >
          ← {artist.name}
        </Link>

        <div className="mt-8 max-w-sm">
          <ManifestRelease
            release={found.release}
            items={found.items}
            openHref={openHrefFor(artist.manifestUrl, found.release.id, artist.handle)}
          />
        </div>

        <p className="mt-10 max-w-2xl text-sm leading-relaxed text-white/50">
          Published by {artist.name} from their own phone, to their own site.
          The file is yours once you have it.
        </p>

        <Link
          href={`/${countryCode}/artists/${artist.handle}`}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/90"
        >
          Everything by {artist.name}
        </Link>
      </div>
    </SoundPlayerProvider>
  )
}
