"use client"

import { motion } from "motion/react"
import { useCallback, useEffect, useRef } from "react"

import { useStageFlight } from "@modules/artists/components/stage-flight"
import { PlayIcon, useAudioTime, useSoundPlayer, type PlayableTrack } from "./context"
import TrackMedia from "./media"
import RingVisualizer from "./visualizer"

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

export default function Stage() {
  const { staged, track } = useSoundPlayer()
  return staged && track ? <StageView key={track.id} track={track} /> : null
}

/**
 * The panel lifted out of the rail into the middle of the screen.
 *
 * The flight is a hand-rolled FLIP inside this fixed layer rather than a
 * shared layoutId: the rail scrolls horizontally, so it clips its overflow,
 * and a layout animation that lands back inside it is cut off at the rail's
 * edges for most of the trip home. Here the panel only ever moves inside a
 * full-screen layer, from the slot's box to the centre and back again.
 */
function StageView({ track }: { track: PlayableTrack }) {
  const player = useSoundPlayer()
  const pulse = useRef<HTMLDivElement>(null)

  /**
   * Where this panel flies from and back to.
   *
   * Read on demand, never captured: `origin` is set when something other than
   * the panel opened the stage - the mini player, say - and the rail can be
   * scrolled while the stage is open, so the slot is often somewhere else by
   * the time the panel goes home.
   */
  const home = useCallback(
    () => player.origin.current ?? player.panelOf(track.id),
    [player, track.id]
  )
  const { panel, close, reduce, style, shade } = useStageFlight({
    home,
    onClosed: player.hideStage,
  })

  /**
   * Space toggles playback, which is this stage's own concern - the shared
   * flight handles Escape and the scroll lock, because every stage wants
   * those, and only a stage with a transport wants this one.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === " " && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault()
        player.toggle()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [player])

  return (
    <div role="dialog" aria-modal="true" aria-label={`Now playing ${track.title}`} className="fixed inset-0 z-[100]">
      <motion.div style={{ opacity: shade }} className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={() => void close()} />

      <motion.div style={{ opacity: shade }} className="pointer-events-none absolute inset-0">
        <RingVisualizer panel={panel} pulse={pulse} still={reduce} />
      </motion.div>

      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="flex flex-1 items-center justify-center">
          <motion.div
            ref={panel}
            style={style}
            className="pointer-events-auto relative aspect-square w-[min(60vw,40vh,400px)] overflow-hidden rounded-large bg-ui-bg-subtle shadow-[0_30px_120px_rgba(0,0,0,0.6)]"
          >
            <div ref={pulse} className="absolute inset-0 will-change-transform">
              <TrackMedia track={track} />
            </div>
          </motion.div>
        </div>

        <motion.div style={{ opacity: shade }} className="pointer-events-auto px-6 pb-10 pt-2">
          <Controls track={track} />
        </motion.div>
      </div>

      <motion.button
        type="button"
        style={{ opacity: shade }}
        onClick={() => void close()}
        aria-label="Close player"
        className="absolute right-5 top-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:border-white hover:text-white"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </motion.button>
    </div>
  )
}

function Controls({ track }: { track: PlayableTrack }) {
  const player = useSoundPlayer()
  const { current, duration } = useAudioTime()

  return (
    <div className="mx-auto w-full max-w-md">
      <p className="luxury-title truncate text-center text-[0.95rem] tracking-[0.06em] text-white">
        {track.title}
      </p>

      <div className="mt-4 flex items-center gap-3 text-[11px] tabular-nums text-white/60">
        <span className="w-9 text-right">{clock(current)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          onChange={(event) => player.seek(Number(event.target.value))}
          aria-label="Seek"
          className="h-1 flex-1 cursor-pointer accent-white"
        />
        <span className="w-9">{clock(duration)}</span>
      </div>

      <div className="mt-5 grid grid-cols-3 items-center">
        <span />
        <button
          type="button"
          onClick={player.toggle}
          aria-label={player.playing ? "Pause" : "Play"}
          className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-white text-black transition hover:scale-105"
        >
          <PlayIcon playing={player.playing} size={20} />
        </button>
        {track.downloadUrl ? (
          <a
            href={track.downloadUrl}
            download
            aria-label={`Download ${track.title}`}
            className="ml-auto inline-flex items-center gap-2 rounded-full border border-white/25 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white transition hover:bg-white hover:text-black"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            Download
          </a>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}
