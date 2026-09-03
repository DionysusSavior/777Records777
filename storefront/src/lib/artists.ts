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
  /**
   * The colour of the light the panel appears to cast on the page under it.
   *
   * Taken from the photograph rather than picked, so the glow reads as spill
   * from the image and not as a coloured box behind it. This is what makes the
   * panel look lifted: on a near-black page a black drop shadow is invisible,
   * so the only thing that can suggest height is light.
   */
  glow: string
  /**
   * Where a feature enquiry for this artist lands.
   *
   * On the artist rather than in one shared inbox, because a booking is a
   * conversation with a person and routing it centrally would mean somebody
   * forwarding mail by hand forever.
   */
  bookingEmail: string
  /**
   * The artist-owned list written by Site Manager direct mode.
   *
   * This is data, not a derived bucket path: another artist can use a CDN or
   * another storage provider without teaching the storefront their layout.
   */
  manifestUrl?: string
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

// Credited to the label rather than to either artist, so it sits on both
// shelves. Filing it under one of them would be a guess, and leaving it off
// both would hide the release entirely.
const LABEL_SOUNDS = [
  "prod_01KQAK7DCK4SFVFGHXSYPHXBB1", // 777RECORDS777 - NEW DEAL
]

export const ARTISTS: Artist[] = [
  {
    handle: "viz",
    name: "Viz",
    tagline: "Sounds, uniforms, amulets",
    photo: "/artists/viz.webp",
    focus: "50% 50%",
    // Cool and dim to match a photograph that is almost entirely shadow. A
    // warm glow here would look pasted on.
    glow: "rgba(148, 163, 184, 0.30)",
    bookingEmail: "vizisreal@gmail.com",
    manifestUrl:
      "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/index.json",
    soundIds: [
      "prod_01KG8CPWZ9T008217JZYTM3EKW", // VIZ - GODDESS OF LOVE (feat. Kap G)
      ...LABEL_SOUNDS,
    ],
    uniformIds: LABEL_UNIFORMS,
    amuletIds: [],
  },
  {
    handle: "dionysus-savior",
    name: "Dionysus Savior",
    tagline: "Sounds, uniforms, amulets",
    photo: "/artists/dionysus-savior.webp",
    focus: "50% 50%",
    // Cool, to match the studio blue of the seated portrait. The red here was
    // taken from the photograph this replaced; left on the new one it read as
    // a colour laid over the panel rather than light spilling out of it.
    glow: "rgba(138, 170, 208, 0.34)",
    bookingEmail: "dionysussavior@outlook.com",
    manifestUrl:
      "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/dion/index.json",
    // Credits taken from the product titles in Medusa, not guessed.
    soundIds: [
      "prod_01KJAM74E83E3PEHKTZNSDEGRV", // DIONYSUS SAVIOR - GONE CRAZY
      ...LABEL_SOUNDS,
    ],
    uniformIds: LABEL_UNIFORMS,
    amuletIds: [],
  },
]

export const getArtist = (handle: string): Artist | undefined =>
  ARTISTS.find((a) => a.handle === handle)
