"use client"

import { useEffect } from "react"

declare const gtag: Function

export default function PageViewConversion() {
  useEffect(() => {
    if (typeof gtag !== "undefined") {
      gtag("event", "conversion", {
        send_to: "AW-11321668434/IRnmCIzrwJ0cENLmy5Yq",
        value: 1.0,
        currency: "USD",
      })
    }
  }, [])

  return null
}
