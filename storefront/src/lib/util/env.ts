export const getBaseURL = () => {
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL
  }

  // Fallbacks to avoid localhost leaking into metadata in production
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }

  if (process.env.NODE_ENV === "production") {
    return "https://777records777.studio"
  }

  return "http://localhost:8000"
}
