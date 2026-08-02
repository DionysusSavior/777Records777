/**
 * The roster. The home page is this list and nothing else.
 *
 * A record label's front door is its artists, not its shelves — so the store
 * sections (Sounds, Uniforms, Amulets) moved one click in, behind whichever
 * artist you picked. Everything a person sees after that point is filtered
 * through this file.
 *
 * Adding an artist is adding an entry here plus a photo in /public/artists.
 * Re-filing a release is moving its product id from one `soundIds` to another.
 */
export type Artist = {
  handle: string
  name: string
  /** Sits under the name on the panel and at the top of the artist page. */
  tagline: string
  photo: string
  /**
   * Where the crop holds at aspect ratios narrower than the photo itself.
   *
   * Both photos are stored already cropped to 16:9 and composed for the panel,
   * so centre is right for them — this exists for the next photo that arrives
   * as a portrait and needs the crop pinned to a face.
   */
  focus: string
  soundIds: string[]
  uniformIds: string[]
  amuletIds: string[]
}

// Label merch rather than any one artist's, so both panels carry it. Split it
// into per-artist lists the day either of them presses their own run.
const LABEL_UNIFORMS = [
  "prod_01KECR7W439TW1VQBTP0QGY4EF", // White BAMN tee
  "prod_01KFCQJC3979EP6BPWJ089TE4Z", // Black BAMN tee
]

export const ARTISTS: Artist[] = [
  {
    handle: "dionysus-savior",
    name: "Dionysus Savior",
    tagline: "Sounds, uniforms, amulets",
    photo: "/artists/dionysus-savior.webp",
    focus: "50% 50%",
    // Every release currently in the catalogue is filed here. Move an id down
    // to Viz's list to re-credit it; nothing else needs to change.
    soundIds: [
      "prod_01KG8CPWZ9T008217JZYTM3EKW", // Goddess of Love (feat. Kap G)
      "prod_01KJAM74E83E3PEHKTZNSDEGRV", // Gone Crazy
      "prod_01KQAK7DCK4SFVFGHXSYPHXBB1", // New Deal
    ],
    uniformIds: LABEL_UNIFORMS,
    amuletIds: [],
  },
  {
    handle: "viz",
    name: "Viz",
    tagline: "Sounds, uniforms, amulets",
    photo: "/artists/viz.webp",
    focus: "50% 50%",
    soundIds: [],
    uniformIds: LABEL_UNIFORMS,
    amuletIds: [],
  },
]

export const getArtist = (handle: string): Artist | undefined =>
  ARTISTS.find((a) => a.handle === handle)
