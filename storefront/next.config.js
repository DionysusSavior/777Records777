/**
 * Medusa Cloud-related environment variables
 */
const S3_HOSTNAME = process.env.MEDUSA_CLOUD_S3_HOSTNAME
const S3_PATHNAME = process.env.MEDUSA_CLOUD_S3_PATHNAME

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  /**
   * Server-only values that must survive into the running server.
   *
   * Amplify gives console variables to the BUILD and not to the SSR runtime,
   * so `process.env.FEATURE_REQUEST_URL` is undefined at request time no
   * matter how the variable is scoped - app-level and branch-level were both
   * tried and both 503'd. This key is Next's documented build-time inlining,
   * which runs HERE, in the build container, where Amplify has in fact set it.
   *
   * It stays off the browser because the only thing that reads it is the
   * route handler at src/app/api/feature-request/route.ts, which is
   * server-only. Inlining places the value in the bundles that reference it,
   * and no client component does. Do not reference it from one.
   *
   * Nothing caught this class of bug before because every other server-side
   * read has a hardcoded fallback - see MEDUSA_BACKEND_URL in src/lib/config.ts.
   * The variable was never load-bearing, so its absence was never visible.
   */
  env: {
    FEATURE_REQUEST_URL: process.env.FEATURE_REQUEST_URL,
    /**
     * Same reason as FEATURE_REQUEST_URL above, and it cost a cutover to
     * relearn on 5 November. Discovery named Render through three builds while
     * OM7_SITE_MANAGER_ENDPOINT was set correctly on Amplify - first
     * branch-level, then app-level - because neither scope reaches the SSR
     * runtime and a bare name is not inlined either. What was actually being
     * read was NEXT_PUBLIC_MEDUSA_BACKEND_URL, the resolver's second choice,
     * which resolves only because its prefix gets it inlined.
     *
     * So the rule on this deployment: a server-side variable is either listed
     * HERE or it does not exist. Server-only, like the one above - the sole
     * reader is the .well-known route handler.
     */
    OM7_SITE_MANAGER_ENDPOINT: process.env.OM7_SITE_MANAGER_ENDPOINT,
    /**
     * The commerce backend, by the rule the two entries above arrived at.
     *
     * Until this line existed, `process.env.MEDUSA_BACKEND_URL` was undefined
     * at request time and what actually answered was
     * NEXT_PUBLIC_MEDUSA_BACKEND_URL, or - where that was missing too - a
     * hardcoded Render host compiled into three separate files. Those
     * fallbacks are gone, so this variable is now load-bearing: without it,
     * src/lib/config.ts points the SDK at localhost and every call fails in
     * the log instead of quietly reaching a host OM7 does not own.
     *
     * Adding it changes which variable wins - this one, over the
     * NEXT_PUBLIC_ copy. BOTH must therefore name the same backend on
     * Amplify, or the browser and the server disagree about where the shop
     * is. Server-only readers: src/lib/config.ts, src/middleware.ts and
     * src/app/api/variant-availability/route.ts.
     */
    MEDUSA_BACKEND_URL: process.env.MEDUSA_BACKEND_URL,
  },
  reactStrictMode: true,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "medusa-public-images.s3.eu-west-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.us-east-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "777records777productpageassets.s3.us-east-2.amazonaws.com",
      },
      ...(S3_HOSTNAME && S3_PATHNAME
        ? [
            {
              protocol: "https",
              hostname: S3_HOSTNAME,
              pathname: S3_PATHNAME,
            },
          ]
        : []),
    ],
  },
  async rewrites() {
    return {
      afterFiles: [
        {
          source: "/admin/:path*",
          destination: "/admin/index.html",
        },
      ],
    }
  },
}

module.exports = nextConfig
