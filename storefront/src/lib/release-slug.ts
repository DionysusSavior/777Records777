/**
 * The address of one release, derived from its title.
 *
 * WHY DERIVED RATHER THAN STORED. Nothing published so far carries a slug, and
 * adding one to the manifest would leave every existing release without an
 * address until it was republished. Derivation gives every release that has
 * ever been published a page on the day the route ships.
 *
 * WHY ONE FILE. The website resolves the route with this, and the publishing
 * service states each release's page URL with it. Two implementations of a
 * rule like this disagree eventually, and the day they do the phone hands
 * somebody a link to a page that does not exist. The service imports this the
 * same way it imports the manifest parser and `artists.ts`: pure data and pure
 * functions, no imports of its own, so esbuild folds it into the function.
 *
 * It is deliberately NOT implemented in Swift. The app is given each release's
 * URL by the service and computes nothing, for the reason `removable` is
 * stated rather than guessed - see catalogue.ts.
 */

/** Latin letters and digits survive; everything else becomes a separator. */
const slugify = (value: string): string =>
  value
    .normalize("NFKD")
    // Strip combining marks so "Café" slugs as "cafe" rather than losing the e.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/**
 * Drop a leading artist name, so "DIONYSUS SAVIOR - IN TIME" is `in-time`
 * rather than `dionysus-savior-in-time`.
 *
 * Only when the title actually begins with the artist's name AND something
 * survives the cut. A release genuinely called "Dionysus Savior" keeps its
 * own name rather than slugging to nothing, and a title that merely contains
 * a dash is untouched - the separator has to follow the name, not appear
 * anywhere in the string.
 */
const withoutArtistPrefix = (title: string, artistName: string): string => {
  const slug = slugify(title)
  const prefix = slugify(artistName)
  if (!prefix || !slug.startsWith(`${prefix}-`)) return slug
  const rest = slug.slice(prefix.length + 1)
  return rest === "" ? slug : rest
}

/** The bare slug for one release, before any collision is considered. */
export const releaseSlug = (title: string, artistName: string): string =>
  withoutArtistPrefix(title, artistName)

/**
 * Addresses for a whole page of releases, with collisions resolved.
 *
 * Two releases can share a title - a single and the album cut of it, a demo
 * and the master. The earlier publish keeps the bare slug and the later one
 * carries a short piece of its id, so the address of something already out in
 * the world does not change because a new release arrived after it.
 *
 * HONEST LIMIT: this is stable against ADDITIONS, not against removals. Delete
 * the earlier of two releases that share a title and the later one inherits
 * the bare slug, changing its address. Storing a slug at publish time is the
 * only way to close that, and it was weighed and declined - nothing published
 * so far has one. The unresolved-slug route answers with the artist's page
 * rather than a 404, so a link that goes stale this way still lands somewhere
 * true.
 *
 * A release whose title slugs to nothing at all - punctuation only, or a
 * script this rule has no letters for - falls back to its id. An ugly address
 * is a smaller failure than no address.
 */
export const releaseSlugs = <T extends { id: string; title: string; publishedAt?: string }>(
  releases: readonly T[],
  artistName: string,
): Map<string, string> => {
  const order = [...releases].sort((left, right) => {
    const by = (left.publishedAt ?? "").localeCompare(right.publishedAt ?? "")
    // Ties broken by id so the result never depends on array order.
    return by !== 0 ? by : left.id.localeCompare(right.id)
  })

  const taken = new Set<string>()
  const slugs = new Map<string, string>()
  for (const release of order) {
    const bare = releaseSlug(release.title, artistName) || slugify(release.id)
    const slug = taken.has(bare) ? `${bare}-${release.id.replace(/-/g, "").slice(0, 6)}` : bare
    taken.add(slug)
    slugs.set(release.id, slug)
  }
  return slugs
}
