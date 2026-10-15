"use client"

import { AnimatePresence, motion } from "motion/react"
import { useRef } from "react"

import { PlayIcon, useAudioTime, useSoundPlayer } from "./context"
import TrackMedia from "./media"

/**
 * What is playing once the stage is closed, so the music can keep going
 * while the visitor scrolls on to the uniforms. Tapping the artwork or the
 * title flies the panel back up from here.
 */
export default function MiniPlayer() {
  const player = useSoundPlayer()
  const { current, duration } = useAudioTime()
  const art = useRef<HTMLButtonElement>(null)
  const track = player.track

  return (
    <AnimatePresence>
      {track && !player.staged && (
        <motion.div
          key="mini-player"
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-md overflow-hidden rounded-2xl border border-white/10 bg-black/80 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl"
        >
          <div className="flex items-center gap-3 p-2 pr-3">
            <button
              ref={art}
              type="button"
              onClick={() => player.showStage(art.current)}
              aria-label={`Open player for ${track.title}`}
              className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/5"
            >
              <TrackMedia track={track} />
            </button>

            <button
              type="button"
              onClick={() => player.showStage(art.current)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="luxury-title block truncate text-[0.8rem] tracking-[0.045em] text-white">
                {track.title}
              </span>
              <span className="block text-[11px] text-white/50">
                {player.playing ? "Now playing" : "Paused"}
              </span>
            </button>

            <button
              type="button"
              onClick={player.toggle}
              aria-label={player.playing ? "Pause" : "Play"}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black"
            >
              <PlayIcon playing={player.playing} />
            </button>

            <button
              type="button"
              onClick={player.stop}
              aria-label="Stop and close"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/60 transition hover:text-white"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="h-[2px] bg-white/10">
            <div
              className="h-full bg-white transition-[width] duration-200 ease-linear"
              style={{ width: duration ? `${(current / duration) * 100}%` : "0%" }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
