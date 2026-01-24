import { NextRequest, NextResponse } from "next/server"

const MEDUSA_BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL ||
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
  "https://seven77records777.onrender.com"

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
