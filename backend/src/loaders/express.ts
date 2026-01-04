import type { Express } from "express"

/**
 * Ensure Express respects proxy headers (needed on Render/behind ALB).
 * This keeps secure cookies and redirects working when TLS terminates upstream.
 */
export default async function trustProxyLoader({ app }: { app: Express }) {
  app.set("trust proxy", 1)
}
