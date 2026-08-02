"use client"

import { useRef } from "react"
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react"

/**
 * A horizontal rail whose cards lean into the direction you are scrolling.
 *
 * The lean is driven by scroll *velocity*, not position: flick it and the row
 * skews and the cards tilt away from the motion, then settle when you stop.
 * That is the whole trick — position-driven effects animate even when nothing
 * is moving, and read as decoration. Velocity-driven ones only appear in
 * response to a hand, so the page feels like it has weight.
 *
 * A spring smooths the raw velocity, because a trackpad reports it in jerky
 * bursts and mapping those straight to a transform looks broken rather than
 * physical.
 *
 * Falls back to an ordinary scrolling row when reduced motion is asked for:
 * the rail still works, it simply stops leaning.
 */
export default function ScrollRail({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  const rail = useRef<HTMLDivElement>(null)

  // Progress of this element's own horizontal scroll, not the page's.
  const { scrollXProgress } = useScroll({ container: rail, axis: "x" })
  const velocity = useVelocity(scrollXProgress)
  const smooth = useSpring(velocity, {
    stiffness: 200,
    damping: 40,
    mass: 0.6,
    restDelta: 0.001,
  })

  // Clamped hard: a fast flick can spike velocity high enough to fold the row
  // in on itself, and the effect should read as lean, never as collapse.
  const skew = useTransform(smooth, [-2.5, 0, 2.5], [8, 0, -8], { clamp: true })
  const lean = useTransform(smooth, [-2.5, 0, 2.5], [-6, 0, 6], { clamp: true })
  const squeeze = useTransform(smooth, [-2.5, 0, 2.5], [0.94, 1, 0.94], {
    clamp: true,
  })

  return (
    <div className="relative">
      <motion.div
        ref={rail}
        style={{ skewX: skew }}
        className={`flex snap-x snap-mandatory gap-6 overflow-x-auto overflow-y-hidden pb-6 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden motion-reduce:!skew-x-0 ${className}`}
      >
        {Array.isArray(children)
          ? children.map((child, i) => (
              <motion.div
                key={i}
                style={{ rotate: lean, scaleY: squeeze }}
                className="w-[68vw] shrink-0 snap-start small:w-[38vw] medium:w-[22vw] motion-reduce:!rotate-0 motion-reduce:!scale-y-100"
              >
                {child}
              </motion.div>
            ))
          : children}
      </motion.div>

      {/* The row runs off both edges rather than ending in a wall, so it reads
          as continuing rather than as a box that happens to be too small. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[var(--bg-page)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[var(--bg-page)] to-transparent" />
    </div>
  )
}
