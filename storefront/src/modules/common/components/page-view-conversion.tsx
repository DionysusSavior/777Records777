"use client"

import { useEffect } from "react"

declare const gtag: Function

export default function PageViewConversion() {
  useEffect(() => {
    if (typeof gtag !== "undefined") {
      gtag("event", "conversion", {
        send_to: "AW-16881611422/dA8VCMHJnpUcEJ7l4_E-",
        value: 1.0,
        currency: "USD",
      })
    }
  }, [])

  return null
}
