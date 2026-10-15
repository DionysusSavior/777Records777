"use client"

import { animate, motion, useMotionValue, useReducedMotion } from "motion/react"
import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

import { PlayIcon, useAudioTime, useSoundPlayer, type PlayableTrack } from "./context"
import TrackMedia from "./media"
import RingVisualizer from "./visualizer"

const OPEN = { type: "spring", stiffness: 170, damping: 24, mass: 0.9 } as const
const CLOSE = { duration: 0.42, ease: [0.32, 0.72, 0, 1] } as const

const onScreen = (rect: DOMRect) =>
  rect.width > 0 &&
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < window.innerHeight &&
  rect.left < window.innerWidth

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
  const reduce = useReducedMotion() ?? false
  const panel = useRef<HTMLDivElement>(null)
  const pulse = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const scaleX = useMotionValue(1)
  const scaleY = useMotionValue(1)
  const panelOpacity = useMotionValue(1)
  const shade = useMotionValue(0)

  /** The offset that puts the centred panel exactly over `rect`. */
  const toward = useCallback(
    (rect: DOMRect) => {
      const element = panel.current!
      const box = element.getBoundingClientRect()
      const homeX = box.left + box.width / 2 - x.get()
      const homeY = box.top + box.height / 2 - y.get()
      return {
        x: rect.left + rect.width / 2 - homeX,
        y: rect.top + rect.height / 2 - homeY,
        scaleX: rect.width / element.offsetWidth,
        scaleY: rect.height / element.offsetHeight,
      }
    },
    [x, y]
  )

  useLayoutEffect(() => {
    const from = (player.origin.current ?? player.panelOf(track.id))?.getBoundingClientRect()
    animate(shade, 1, { duration: 0.35 })

    if (!reduce && from && onScreen(from)) {
      const start = toward(from)
      x.set(start.x)
      y.set(start.y)
      scaleX.set(start.scaleX)
      scaleY.set(start.scaleY)
      animate(x, 0, OPEN)
      animate(y, 0, OPEN)
      animate(scaleX, 1, OPEN)
      animate(scaleY, 1, OPEN)
    } else {
      scaleX.set(0.94)
      scaleY.set(0.94)
      panelOpacity.set(0)
      animate(scaleX, 1, { duration: 0.3 })
      animate(scaleY, 1, { duration: 0.3 })
      animate(panelOpacity, 1, { duration: 0.3 })
    }
    // Opening runs once per mount; the stage is keyed by track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = useCallback(async () => {
    if (closing.current) return
    closing.current = true
    const to = player.panelOf(track.id)?.getBoundingClientRect()
    const fade = animate(shade, 0, { duration: 0.32 })

    if (!reduce && to && onScreen(to)) {
      const end = toward(to)
      await Promise.all([
        animate(x, end.x, CLOSE),
        animate(y, end.y, CLOSE),
        animate(scaleX, end.scaleX, CLOSE),
        animate(scaleY, end.scaleY, CLOSE),
        fade,
      ])
    } else {
      await Promise.all([
        animate(scaleX, 0.94, { duration: 0.25 }),
        animate(scaleY, 0.94, { duration: 0.25 }),
        animate(panelOpacity, 0, { duration: 0.25 }),
        fade,
      ])
    }
    player.hideStage()
  }, [player, track.id, reduce, toward, x, y, scaleX, scaleY, panelOpacity, shade])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void close()
      if (event.key === " " && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault()
        player.toggle()
      }
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener("keydown", onKey)
    }
  }, [close, player])

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
            style={{ x, y, scaleX, scaleY, opacity: panelOpacity }}
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
