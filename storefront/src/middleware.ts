import { HttpTypes } from "@medusajs/types"
import { NextRequest, NextResponse } from "next/server"

const backendUrl =
  process.env.MEDUSA_BACKEND_URL ||
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
  "https://seven77records777.onrender.com"

const publishableKey =
  process.env.MEDUSA_PUBLISHABLE_KEY ||
  process.env.MEDUSA_PUBLISHABLE_API_KEY ||
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_API_KEY
const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "us"

const regionMapCache = {
  regionMap: new Map<string, HttpTypes.StoreRegion>(),
  regionMapUpdated: Date.now(),
}

async function getRegionMap(cacheId: string) {
  const { regionMap, regionMapUpdated } = regionMapCache

  if (!backendUrl) {
    throw new Error(
      "Middleware.ts: Error fetching regions. Did you set up regions in your Medusa Admin and define a MEDUSA_BACKEND_URL environment variable? Note that the variable is no longer named NEXT_PUBLIC_MEDUSA_BACKEND_URL."
    )
  }

  if (!publishableKey) {
    throw new Error(
      "Middleware.ts: Missing publishable API key. Set NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY (or MEDUSA_PUBLISHABLE_KEY / MEDUSA_PUBLISHABLE_API_KEY) in your environment."
    )
  }

  if (
    !regionMap.keys().next().value ||
    regionMapUpdated < Date.now() - 3600 * 1000
  ) {
    // Fetch regions from Medusa. We can't use the JS client here because middleware is running on Edge and the client needs a Node environment.
    const res = await fetch(`${backendUrl}/store/regions`, {
      headers: publishableKey
        ? { "x-publishable-api-key": publishableKey }
        : {},
      next: {
        revalidate: 3600,
        tags: [`regions-${cacheId}`],
      },
      cache: "force-cache",
    })

    if (!res.ok) {
      throw new Error(`Error fetching regions: ${res.status}`)
    }

    const { regions } = await res.json()

    if (!regions?.length) {
      throw new Error(
        "No regions found. Please set up regions in your Medusa Admin."
      )
    }

    // Create a map of country codes to regions.
    regions.forEach((region: HttpTypes.StoreRegion) => {
      region.countries?.forEach((c) => {
        regionMapCache.regionMap.set(c.iso_2 ?? "", region)
      })
    })

    regionMapCache.regionMapUpdated = Date.now()
  }

  return regionMapCache.regionMap
}

/**
 * Fetches regions from Medusa and sets the region cookie.
 * @param request
 * @param response
 */
async function getCountryCode(
  request: NextRequest,
  regionMap: Map<string, HttpTypes.StoreRegion | number>
) {
  try {
    let countryCode

    const vercelCountryCode = request.headers
      .get("x-vercel-ip-country")
      ?.toLowerCase()

    const urlCountryCode = request.nextUrl.pathname.split("/")[1]?.toLowerCase()

    if (urlCountryCode && regionMap.has(urlCountryCode)) {
      countryCode = urlCountryCode
    } else if (vercelCountryCode && regionMap.has(vercelCountryCode)) {
      countryCode = vercelCountryCode
    } else if (regionMap.has(DEFAULT_REGION)) {
      countryCode = DEFAULT_REGION
    } else if (regionMap.keys().next().value) {
      countryCode = regionMap.keys().next().value
    }

    return countryCode
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        "Middleware.ts: Error getting the country code. Did you set up regions in your Medusa Admin and define a MEDUSA_BACKEND_URL environment variable? Note that the variable is no longer named NEXT_PUBLIC_MEDUSA_BACKEND_URL."
      )
    }
  }
}

/**
 * Middleware to handle region selection and onboarding status.
 */
export async function middleware(request: NextRequest) {
  // Short-circuit static assets to avoid unnecessary work
  if (request.nextUrl.pathname.includes(".")) {
    return NextResponse.next()
  }

  const cacheIdCookie = request.cookies.get("_medusa_cache_id")
  const cacheId = cacheIdCookie?.value || crypto.randomUUID()

  /**
   * A COMMERCE OUTAGE MUST NOT TAKE DOWN PAGES THAT SELL NOTHING.
   *
   * getRegionMap throws when the Medusa backend answers non-ok, and this
   * matcher covers `/`, every artist page and every free download - so an
   * unreachable commerce service used to return 500 for the whole site,
   * including pages that never touch it. A one-hour force-cache window hid it
   * until an edge went cold, which is the worst version: rare, and total.
   *
   * Falling back to DEFAULT_REGION keeps every page serving. What degrades is
   * only region selection, which is what the backend was being asked about -
   * a visitor gets the default region instead of their own, and the store
   * still works. That is the right trade against the site being down.
   */
  let regionMap: Awaited<ReturnType<typeof getRegionMap>> | null = null
  try {
    regionMap = await getRegionMap(cacheId)
  } catch (error) {
    console.error(
      "middleware: region lookup failed, serving with the default region.",
      error instanceof Error ? error.message : error
    )
  }

  if (!regionMap || !regionMap.keys().next().value) {
    return regionFallback(request, cacheId, cacheIdCookie !== undefined)
  }

  const countryCode = regionMap && (await getCountryCode(request, regionMap))
  const urlHasCountryCode =
    countryCode && request.nextUrl.pathname.split("/")[1].includes(countryCode)

  // URL already has a country code
  if (urlHasCountryCode) {
    if (cacheIdCookie) {
      return NextResponse.next()
    }

    const res = NextResponse.redirect(request.nextUrl.href, 307)
    res.cookies.set("_medusa_cache_id", cacheId, {
      maxAge: 60 * 60 * 24,
    })
    return res
  }

  const redirectPath =
    request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname
  const queryString = request.nextUrl.search ? request.nextUrl.search : ""

  // No country code in URL: redirect or error
  if (countryCode) {
    const redirectUrl = `${request.nextUrl.origin}/${countryCode}${redirectPath}${queryString}`
    return NextResponse.redirect(redirectUrl, 307)
  }

  return regionFallback(request, cacheId, cacheIdCookie !== undefined)
}

/**
 * Route on DEFAULT_REGION alone, with no backend involved.
 *
 * Reached when the region lookup failed or returned nothing. It performs the
 * same country-code prefixing the healthy path does, so URLs stay identical
 * and a later request that DOES reach the backend is not a different site.
 */
function regionFallback(
  request: NextRequest,
  cacheId: string,
  hasCookie: boolean
) {
  const urlHasCountryCode = request.nextUrl.pathname
    .split("/")[1]
    ?.toLowerCase() === DEFAULT_REGION.toLowerCase()

  if (urlHasCountryCode) {
    return NextResponse.next()
  }

  const path = request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname
  const query = request.nextUrl.search ?? ""
  const res = NextResponse.redirect(
    `${request.nextUrl.origin}/${DEFAULT_REGION}${path}${query}`,
    307
  )
  // Set the cache id here too, so a visitor arriving during an outage does not
  // bounce through this redirect on every single request afterwards.
  if (!hasCookie) {
    res.cookies.set("_medusa_cache_id", cacheId, { maxAge: 60 * 60 * 24 })
  }
  return res
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|images|assets|png|svg|jpg|jpeg|gif|webp).*)",
  ],
}
