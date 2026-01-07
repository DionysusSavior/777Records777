"use client"

import { useEffect, useState } from "react"

type SplashScreenProps = {
  children: React.ReactNode
}

export default function SplashScreen({ children }: SplashScreenProps) {
  const [isFading, setIsFading] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const fadeTimer = setTimeout(() => setIsFading(true), 1800)
    const hideTimer = setTimeout(() => setIsVisible(false), 3200)

    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(hideTimer)
    }
  }, [])

  return (
    <div className="relative">
      {isVisible && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black text-white transition-opacity duration-1000 ease-out ${
            isFading ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className="text-3xl tracking-[0.35em] uppercase">
            777Records777
          </span>
        </div>
      )}
      {children}
    </div>
  )
}
