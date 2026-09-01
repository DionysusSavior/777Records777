import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const backend = process.env.MEDUSA_BACKEND_URL
    ?? process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
    ?? "http://localhost:9000"
  const backendUrl = new URL(backend)
  if (process.env.NODE_ENV === "production" && backendUrl.protocol !== "https:") {
    return NextResponse.json({ error: "Site Manager is not configured." }, { status: 503 })
  }
  const endpoint = new URL("/om7/site-manager/v1", backendUrl).toString().replace(/\/$/, "")

  return NextResponse.json({
    protocol: "om7.site-manager",
    version: 1,
    endpoint,
    authentication: "site-issued-bearer",
    transport: "direct-put",
  }, {
    headers: {
      "cache-control": "public, max-age=300",
    },
  })
}
