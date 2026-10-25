import { Metadata } from "next"
import { notFound } from "next/navigation"

import ArtistHero from "@modules/artists/components/artist-hero"
import SoundShelf from "@modules/artists/components/sound-shelf"
import MovieShelf from "@modules/artists/components/movie-shelf"
import { SoundPlayerProvider } from "@modules/artists/components/sound-player/context"
import UniformShelf from "@modules/artists/components/uniform-shelf"
import FeatureRequest from "@modules/artists/components/feature-request"
import Om7PlayerSection from "@modules/artists/components/om7player-section"
import { getArtist, type Movie } from "@lib/artists"
import { getSiteManagerMovies } from "@lib/site-manager-manifest"

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
  if (!artist) return { title: "777Records777 Studio" }
  return {
    title: `${artist.name} | 777Records777 Studio`,
    description: `${artist.name} — ${artist.tagline}.`,
  }
}

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="content-container border-t border-white/10 py-12 small:py-20">
      <h2 className="text-2xl font-bold text-white small:text-3xl">{title}</h2>
      {note && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/50">{note}</p>}
      <div className="mt-8">{children}</div>
    </section>
  )
}

/**
 * One artist, one page. Nothing here sends you somewhere else to finish.
 *
 * The order is a sequence, not a menu: hear it, wear it, book it, then take it
 * with you. The app is last because it is the only link that leaves the site.
 */
export default async function ArtistPage(props: Props) {
  const { countryCode, handle } = await props.params
  const artist = getArtist(handle)

  if (!artist) {
    notFound()
  }

  // Static films stay even when the manifest cannot be read. Published films
  // are added beside them and never replace a shared director's cut.
  const published = await getSiteManagerMovies(artist.manifestUrl)
  const seen = new Set(artist.movies.map((movie) => movie.url))
  const movies: Movie[] = [
    ...artist.movies,
    ...published
      .filter((movie) => !seen.has(movie.url))
      .map((movie) => ({
        title: movie.title,
        url: movie.url,
        poster: movie.poster,
        bytes: movie.bytes,
      })),
  ]

  return (
    <SoundPlayerProvider accent={artist.glow} artistName={artist.name}>
      <ArtistHero artist={artist} />

      <Section title="Sounds" note="Free to download. The files are yours once you have them.">
        <SoundShelf
          countryCode={countryCode}
          productIds={artist.soundIds}
          manifestUrl={artist.manifestUrl}
        />
      </Section>

      {movies.length > 0 && (
        <Section title="Movies" note="Watch it here, or download the file and keep it.">
          <MovieShelf movies={movies} />
        </Section>
      )}

      <Section title="Uniforms">
        <UniformShelf countryCode={countryCode} productIds={artist.uniformIds} />
      </Section>

      <Section
        title="Feature price"
        note={`A verse is $500, the same wherever it is recorded. A video appearance depends on where it is and what the travel costs, so tell ${artist.name} where and it comes back with a number.`}
      >
        <FeatureRequest artistHandle={artist.handle} artistName={artist.name} />
      </Section>

      <Section title="OM7Player" note="Your library on your phone, plus notes, projects and budgets — and a directory of independent artists who own their own sites. No account to play, no ads, no subscriptions.">
        <Om7PlayerSection />
      </Section>
    </SoundPlayerProvider>
  )
}
