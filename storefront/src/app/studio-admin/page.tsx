import type { Metadata } from "next"
import StudioAdmin from "./studio-admin"

export const metadata: Metadata = {
  title: "Studio admin",
  description: "Grant an artist publishing access to one page on 777records777.studio.",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

/**
 * The administrator Dion logs into on the studio site.
 *
 * Not Medusa's /app. The publishing service this page talks to is not the
 * live one until he approves the cutover, and this page does not guess a
 * service URL when none is configured.
 */
export default function StudioAdminPage() {
  return (
    <StudioAdmin
      serviceUrl={process.env.NEXT_PUBLIC_STUDIO_SERVICE_URL ?? ""}
      cognitoDomain={process.env.NEXT_PUBLIC_STUDIO_COGNITO_DOMAIN ?? ""}
      clientId={process.env.NEXT_PUBLIC_STUDIO_COGNITO_CLIENT_ID ?? ""}
    />
  )
}
