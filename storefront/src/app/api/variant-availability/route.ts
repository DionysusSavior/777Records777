import { NextRequest, NextResponse } from "next/server"

// No hardcoded host; see src/lib/config.ts. Unset is answered below rather
// than by `new URL()` throwing a 500 out of a route whose job is to report
// what a variant's availability is.
const MEDUSA_BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL

const ADMIN_API_TOKEN =
  process.env.MEDUSA_ADMIN_API_TOKEN ||
  process.env.MEDUSA_ADMIN_API_KEY ||
  process.env.MEDUSA_ADMIN_TOKEN

export async function GET(req: NextRequest) {
  const variantId = req.nextUrl.searchParams.get("variantId")

  if (!variantId) {
    return NextResponse.json(
      { error: "variantId is required" },
      { status: 400 }
    )
  }

  if (!MEDUSA_BACKEND_URL) {
    console.error(
      "variant-availability: MEDUSA_BACKEND_URL is not set. It reaches the server only if next.config.js declares it."
    )
    return NextResponse.json(
      { error: "Availability is unavailable." },
      { status: 503 }
    )
  }

  const url = new URL("/admin/custom", MEDUSA_BACKEND_URL)
  url.searchParams.set("variantId", variantId)

  const headers: Record<string, string> = {}
  if (ADMIN_API_TOKEN) {
    const token = ADMIN_API_TOKEN.trim()
    headers.authorization = token.startsWith("sk_")
      ? `Basic ${token}`
      : `Bearer ${token}`
  }

  const response = await fetch(url.toString(), {
    headers,
    cache: "no-store",
  })

  if (!response.ok) {
    const message = await response.text()
    return NextResponse.json(
      { error: message || "Failed to fetch availability" },
      { status: response.status }
    )
  }

  const data = await response.json()
  return NextResponse.json({
    sellable: Boolean(data?.sellable),
    preorder: Boolean(data?.preorder),
  })
}
