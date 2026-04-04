"use client"

import { useEffect } from "react"

declare const gtag: Function

export default function AddToCartConversion() {
  useEffect(() => {
    if (typeof gtag !== "undefined") {
      gtag("event", "conversion", {
        send_to: "AW-16881611422/xqAACJn_spUcEJ7l4_E-",
        value: 1.0,
        currency: "USD",
      })
    }
  }, [])

  return null
}
