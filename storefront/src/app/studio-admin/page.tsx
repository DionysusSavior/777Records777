import { redirect } from "next/navigation"
export const dynamic = "force-dynamic"
// Preserve invitation and OAuth parameters; existing bookmarks remain valid.
export default async function LegacyAdmin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(name, value)
  }
  if (query.has("code")) query.set("legacyCallback", "1")
  redirect(`/admin${query.size ? `?${query}` : ""}`)
}
