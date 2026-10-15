"use client"

import { animate, useMotionValue, useReducedMotion } from "motion/react"
import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

const OPEN = { type: "spring", stiffness: 170, damping: 24, mass: 0.9 } as const
const CLOSE = { duration: 0.42, ease: [0.32, 0.72, 0, 1] } as const

const onScreen = (rect: DOMRect) =>
  rect.width > 0 &&
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < window.innerHeight &&
  rect.left < window.innerWidth

/**
 * The flight a panel makes from its slot in a rail to the middle of the screen.
 *
 * Extracted from the sound stage so the movie stage can make the same journey
 * rather than own a second copy of it. What is shared is only the MOVEMENT —
 * where it starts, where it lands, how it goes home, and the escape hatches.
 * What each stage shows when it arrives is its own business: a sound brings a
 * ring visualiser and a scrubber, a movie brings a video and its controls.
 *
 * A hand-rolled FLIP rather than a shared `layoutId`, and the reason is the
 * rail: it scrolls horizontally, so it clips its overflow, and a layout
 * animation landing back inside it is cut off at the rail's edges for most of
 * the trip home. Here the panel only ever moves inside a full-screen layer,
 * from the slot's box to the centre and back.
 *
 * `home` is read at the moment it is needed rather than captured, because the
 * rail can be scrolled while the stage is open — the slot a panel flew out of
 * is often somewhere else by the time it flies back, and a stale rect sends it
 * to where that slot used to be.
 */
export function useStageFlight({
  home,
  onClosed,
}: {
  home: () => HTMLElement | null
  onClosed: () => void
}) {
  const reduce = useReducedMotion() ?? false
  const panel = useRef<HTMLDivElement>(null)
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
    const from = home()?.getBoundingClientRect()
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
      // No slot to fly from - scrolled away, or reduced motion asked for. A
      // small settle rather than a flight across a screen nobody is looking at.
      scaleX.set(0.94)
      scaleY.set(0.94)
      panelOpacity.set(0)
      animate(scaleX, 1, { duration: 0.3 })
      animate(scaleY, 1, { duration: 0.3 })
      animate(panelOpacity, 1, { duration: 0.3 })
    }
    // Opening runs once per mount; callers key the stage by what it holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = useCallback(async () => {
    if (closing.current) return
    closing.current = true
    const to = home()?.getBoundingClientRect()
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
    onClosed()
  }, [home, onClosed, reduce, toward, x, y, scaleX, scaleY, panelOpacity, shade])

  /**
   * Escape closes, and the page behind does not scroll while this is open.
   *
   * The previous overflow is restored rather than set to "", so a stage opened
   * over something that was already locked does not unlock it on the way out.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void close()
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener("keydown", onKey)
    }
  }, [close])

  return { panel, close, reduce, style: { x, y, scaleX, scaleY, opacity: panelOpacity }, shade }
}
