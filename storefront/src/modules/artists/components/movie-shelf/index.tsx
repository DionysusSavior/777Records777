import type { Movie } from "@lib/artists"
import ScrollRail from "@modules/common/components/scroll-rail"

// Decimal units, because that is what Finder and the iPhone Files app report.
const formatSize = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`

/**
 * The full videos, played where they sit, with the file one click away.
 *
 * Unlike the sound panels these do not autoplay: a muted loop is the point of
 * a sound's reel, but a movie is minutes long with sound that matters, so it
 * waits on its poster until someone presses play. `preload="none"` keeps a
 * page visit from pulling hundreds of megabytes nobody asked for.
 *
 * The size is on the button because it is large enough to matter on a phone
 * plan, and the visitor should know that before the download starts.
 */
export default function MovieShelf({ movies }: { movies: Movie[] }) {
  return (
    <ScrollRail>
      {movies.map((movie) => (
        <div key={movie.url} data-testid="movie-wrapper">
          <video
            src={movie.url}
            poster={movie.poster}
            controls
            playsInline
            preload="none"
            className="aspect-[9/16] w-full rounded-large bg-black object-cover"
          />

          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="luxury-title min-w-0 flex-1 truncate text-[0.86rem] tracking-[0.045em] text-white">
              {movie.title}
            </span>

            <a
              href={movie.url}
              download
              aria-label={`Download ${movie.title} (${formatSize(movie.bytes)})`}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/90"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              Download
              <span className="hidden font-normal opacity-60 small:inline">{formatSize(movie.bytes)}</span>
            </a>
          </div>
        </div>
      ))}
    </ScrollRail>
  )
}
