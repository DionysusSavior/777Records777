#!/usr/bin/env node
// Writes a `.om7` release bundle: the song, the short reel that plays behind
// it, and the way back to the artist's own site, in one file. The format is
// specified in OM7-RELEASE-BUNDLE.md over in the music-metaverse repo and this
// is the producer half of it — the app is the consumer half and is separate.
//
//   node scripts/make-om7-bundle.mjs --audio <file> --title "New Deal" \
//     --artist "Dionysus Savior" [--loop clip.mp4] [--cover art.jpg] \
//     [--font Title.otf] \
//     [--site https://777records777.studio] [--card <uuid>] [--out dir]
//
// The manifest carries three more optional fields, so the writer does too:
//
//   [--released 2026-08-16] [--label "777Records777"] [--note "Turn it up."]
//
// What lands on disk, for `--title "New Deal"`:
//
//   New Deal.om7
//   ├── om7.json          the manifest
//   ├── audio.wav         the song
//   ├── loop.mp4          the reel, if one was given
//   ├── cover.jpg         artwork, if one was given
//   └── font.otf          the face the title is set in, if one was given
//
// A FONT IS THE ONE MEMBER YOU MAY NOT OWN THE RIGHT TO SHIP. Audio, artwork
// and a reel are the artist's own work. A typeface is licensed, and most
// licences sell desktop, web and app use separately while forbidding
// redistribution outright - which is exactly what putting one in a file
// somebody downloads is. Ship a face you drew, commissioned with those rights,
// or one under a licence that permits it (SIL OFL does). Buying a font to
// design a cover does not grant this.
//
// Anything not given is left OUT of the manifest rather than written empty. An
// empty `cover` key is a claim that there is artwork, and the reader would go
// looking for a file that is not in the archive.
//
// Nothing is written until every check has run, so a bundle that fails to
// validate leaves no half-made file behind.

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const FORMAT = 'om7.release';

// Bumped only for a change an old reader would misread. Adding an optional
// field is not one of those, so adding one does not touch this.
const VERSION = 1;

const USAGE = `Writes a .om7 release bundle.

  node scripts/make-om7-bundle.mjs --audio <file> --title <title> --artist <name>
    [--loop clip.mp4] [--cover art.jpg] [--font Title.otf]
    [--site https://…] [--card <uuid>]
    [--released YYYY-MM-DD] [--label <label>] [--note <one or two lines>]
    [--out <dir>]

--out defaults to the current directory.`;

// ---- Arguments ----------------------------------------------------------

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

/** Everything wrong with the run. All of it is collected, then printed at once. */
const problems = [];

/** Things worth saying that are not worth refusing over. */
const warnings = [];

/**
 Reads `--name value` off the command line.

 A value that itself looks like a flag is treated as missing rather than
 consumed, so `--loop --cover art.jpg` complains that `--loop` was given
 nothing instead of quietly trying to open a file called `--cover`.
 */
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    problems.push(`${name} needs a value.`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    problems.push(`${name} was given nothing but spaces.`);
    return null;
  }
  return trimmed;
};

/** Same, but the run cannot go ahead without it. */
const required = (name) => {
  const value = flag(name);
  if (value === null && !args.includes(name)) problems.push(`${name} is required.`);
  return value;
};

const audioPath = required('--audio');
const title = required('--title');
const artist = required('--artist');
const loopPath = flag('--loop');
const coverPath = flag('--cover');
const fontPath = flag('--font');
const site = flag('--site');
const card = flag('--card');
const released = flag('--released');
const label = flag('--label');
const note = flag('--note');
const outDir = flag('--out') ?? '.';

// ---- Reading and checking the files -------------------------------------

/** Extensions AVFoundation opens without argument. Anything else is a warning, not a refusal. */
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.aif', '.aiff', '.caf', '.flac', '.alac']);

/** What a phone shows as artwork. */
const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic']);

/** Spotify's Canvas bounds, borrowed by the spec because they are what artists already cut for. */
const LOOP_MIN_SECONDS = 3;
const LOOP_MAX_SECONDS = 8;
const LOOP_MAX_BYTES = 5 * 1024 * 1024;

// A master is often 40-odd MB, and unlike the streaming case the whole bundle
// travels as one download, so the size is the send rather than a stall. Worth
// a word, never worth a refusal.
const AUDIO_CHATTY_BYTES = 25 * 1024 * 1024;

/** Bytes, in the shortest form that is still honest about the size. */
const size = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KB`
  : `${bytes} B`;

/**
 Reads a file named by a flag, or records why it could not be read.

 Returns null on any failure so the caller can carry on collecting problems
 rather than stopping at the first one.
 */
const readInput = (name, path) => {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    problems.push(`${name} ${path} does not exist.`);
    return null;
  }
  if (!stat.isFile()) {
    problems.push(`${name} ${path} is not a file.`);
    return null;
  }
  if (stat.size === 0) {
    problems.push(`${name} ${path} is empty.`);
    return null;
  }
  return readFileSync(path);
};

const audio = audioPath === null ? null : readInput('--audio', audioPath);
const audioExtension = audioPath === null ? '' : extname(audioPath).toLowerCase();

if (audio) {
  if (audioExtension === '') {
    // The importer drops the audio into the player folder as an ordinary file
    // and the player identifies files by extension, so one without is a track
    // that arrives and never appears in the list.
    problems.push(`--audio ${audioPath} has no file extension; the player identifies files by it.`);
  } else if (!AUDIO_EXTENSIONS.has(audioExtension)) {
    warnings.push(`--audio is ${audioExtension}, which AVFoundation may not open. The bundle is still valid.`);
  }
  if (audio.length > AUDIO_CHATTY_BYTES) {
    warnings.push(
      `--audio is ${size(audio.length)}, so the bundle will be roughly that big to send. ` +
        'A 192 kbps mp3 of the same master is about a tenth of it.',
    );
  }
}

// ---- The reel -----------------------------------------------------------

/**
 Finds a box of the given type between two offsets, or null.

 MP4 is a tree of length-prefixed boxes: four bytes of size, four ASCII bytes
 of type, then the contents. Only the two boxes on the way to the duration are
 wanted here, so the walk is a plain sibling scan rather than a parser.
 */
const findBox = (buf, start, end, type) => {
  let at = start;
  while (at + 8 <= end) {
    let length = buf.readUInt32BE(at);
    const kind = buf.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (length === 1) {
      // A 64-bit size means a box bigger than 4 GB. A five second reel is not
      // one, but the walk still has to step over it correctly to reach the
      // next sibling.
      if (at + 16 > end) return null;
      const large = buf.readBigUInt64BE(at + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      length = Number(large);
      header = 16;
    } else if (length === 0) {
      length = end - at; // the last box, running to the end of the file
    }
    if (length < header || at + length > end) return null; // malformed; stop rather than guess
    if (kind === type) return { start: at + header, end: at + length };
    at += length;
  }
  return null;
};

/**
 How long an MP4 says it is, in seconds, or null when it does not say.

 The movie header carries a timescale and a duration in those units, which is
 all that is needed and needs no decoder. A fragmented MP4 writes zero there
 and keeps the real length out in the fragments — that is reported as unknown
 rather than as a nought-second clip, because a warning about a clip being too
 short when nobody measured it is worse than no warning.
 */
const mp4Seconds = (buf) => {
  const moov = findBox(buf, 0, buf.length, 'moov');
  if (!moov) return null;
  const mvhd = findBox(buf, moov.start, moov.end, 'mvhd');
  if (!mvhd) return null;

  const version = buf[mvhd.start];
  const at = mvhd.start + 4; // past the version byte and the three flag bytes
  const needed = version === 1 ? 32 : 20;
  if (mvhd.end - mvhd.start < needed) return null;

  const timescale = version === 1 ? buf.readUInt32BE(at + 16) : buf.readUInt32BE(at + 8);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(at + 20)) : buf.readUInt32BE(at + 12);
  if (!timescale || !duration) return null;
  return duration / timescale;
};

const loop = loopPath === null ? null : readInput('--loop', loopPath);

if (loop) {
  if (extname(loopPath).toLowerCase() !== '.mp4') {
    problems.push(`--loop must be an mp4. The spec is H.264 in MP4, and ${loopPath} is not one.`);
  } else if (loop.length < 8 || loop.toString('latin1', 4, 8) !== 'ftyp') {
    // `ftyp` is the first box of every ISO base media file. Without it the
    // name is the only thing claiming this is an mp4, and the name is wrong.
    problems.push(`--loop ${loopPath} is named .mp4 but has no ftyp box, so it is not an MP4.`);
  } else {
    // Everything from here down is a warning by design. The spec says a loop
    // outside the bounds is IGNORED by the reader, not rejected — a bundle
    // that refuses to open because a video is nine seconds long is a worse
    // outcome than one that quietly plays the music. Refusing to write it
    // here would be the same mistake one step earlier.
    const seconds = mp4Seconds(loop);
    if (seconds === null) {
      warnings.push('--loop does not state a duration, so the 3 to 8 second rule could not be checked.');
    } else if (seconds < LOOP_MIN_SECONDS || seconds > LOOP_MAX_SECONDS) {
      warnings.push(
        `--loop is ${seconds.toFixed(1)}s, outside the ${LOOP_MIN_SECONDS} to ${LOOP_MAX_SECONDS} second rule. ` +
          'It goes in the bundle; a reader that enforces the rule will ignore it and the song still plays.',
      );
    }
    if (loop.length > LOOP_MAX_BYTES) {
      warnings.push(`--loop is ${size(loop.length)}, over the ${size(LOOP_MAX_BYTES)} the spec asks for.`);
    }
    // Not checked here, and deliberately: that the video is H.264 rather than
    // some other codec in the same container, that it is silent, and that it
    // is 9:16. None can be read without decoding, and tkhd's dimensions lie
    // whenever a rotation matrix is set — a wrong warning about a correctly
    // cut vertical clip would be worse than staying quiet.
  }
}

// ---- Artwork, site, card, date ------------------------------------------

const cover = coverPath === null ? null : readInput('--cover', coverPath);
const coverExtension = coverPath === null ? '' : extname(coverPath).toLowerCase();

const font = fontPath === null ? null : readInput('--font', fontPath);
const fontExtension = fontPath === null ? '' : extname(fontPath).toLowerCase();

/*
 Refused rather than warned about, unlike the cover.

 The reader only looks for .otf and .ttf beside a track, so any other
 extension is a file that travels in the bundle, costs its bytes, and is never
 read - a silent no-op rather than a degraded one. Better to say so here.
*/
if (font && !['.otf', '.ttf'].includes(fontExtension)) {
  problems.push(`--font must be .otf or .ttf; got ${fontExtension || 'no extension'}.`);
}
// The two this was built against are 8 KB and 12 KB. A display face carries a
// couple of dozen glyphs; anything near a megabyte is a full text family and
// probably not what was meant.
if (font && font.length > 2 * 1024 * 1024) {
  problems.push(`--font is ${(font.length / 1024 / 1024).toFixed(1)} MB. The reader refuses anything over 2 MB.`);
}

if (cover && !COVER_EXTENSIONS.has(coverExtension)) {
  warnings.push(`--cover is ${coverExtension || 'extensionless'}, which may not display. The bundle is still valid.`);
}

if (site !== null) {
  let url = null;
  try {
    url = new URL(site);
  } catch {
    problems.push(`--site ${site} is not a URL.`);
  }
  // https only, and this one refuses rather than warns: the app opens this
  // link on somebody's phone, and quietly downgrading their way back to the
  // artist to an unencrypted hop is not a thing to do behind their back.
  if (url && url.protocol !== 'https:') {
    problems.push(`--site must be https. ${site} is ${url.protocol.replace(':', '')}.`);
  }
}

/** The same shape the directory's own validator accepts, so a card id that works on the web works here. */
const CARD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (card !== null && !CARD_ID_RE.test(card)) {
  // A malformed id is not a harmless typo. It matches no card, so every click
  // from the app is counted for nobody and the artist quietly gets nothing.
  problems.push(`--card ${card} is not a card id. It is a UUID, as the directory writes it.`);
}

if (released !== null) {
  // A day, not an instant. It is checked as text and stored as text: parsing
  // it into a Date and printing it back moves the release by a timezone, which
  // is the bug OM7Day exists to stop.
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(released);
  const day = parts && new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  const real =
    day &&
    day.getUTCFullYear() === Number(parts[1]) &&
    day.getUTCMonth() === Number(parts[2]) - 1 &&
    day.getUTCDate() === Number(parts[3]);
  if (!real) problems.push(`--released ${released} is not a real day. It is YYYY-MM-DD.`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`error: ${problem}`);
  console.error('\nNothing was written.');
  process.exit(1);
}

// ---- The manifest -------------------------------------------------------

// The names inside the archive. The spec lets a producer keep its own naming
// and declares the real names in the manifest, which is why this can choose.
// It chooses the convention rather than the source file names because those
// bring two problems for nothing: a source file called om7.json would collide
// with the manifest, and any character a foreign file system dislikes would
// ride into an archive that has to open everywhere. The original name is not
// lost — the title is in the manifest, and the app names what it extracts
// after that.
const AUDIO_ENTRY = `audio${audioExtension}`;
const LOOP_ENTRY = 'loop.mp4';
const COVER_ENTRY = `cover${coverExtension}`;
const FONT_ENTRY = `font${fontExtension}`;

const manifest = {
  format: FORMAT,
  version: VERSION,
  title,
  artist,
  audio: AUDIO_ENTRY,
};

if (loop) manifest.loop = LOOP_ENTRY;
if (cover) manifest.cover = COVER_ENTRY;
if (font) manifest.titleFont = FONT_ENTRY;
if (site !== null) manifest.site = site;
if (card !== null) manifest.cardId = card.toLowerCase(); // the directory stores them lowercased
if (released !== null) manifest.released = released;
if (label !== null) manifest.label = label;
if (note !== null) manifest.note = note;

// The spec prints the manifest as jsonc so it can annotate the fields. Real
// JSON has no comments, so none are written.
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

// om7.json goes in first so a reader can decide whether it wants the rest
// before it has pulled a single byte of audio.
const entries = [{ name: 'om7.json', data: manifestBytes }];
entries.push({ name: AUDIO_ENTRY, data: audio });
if (loop) entries.push({ name: LOOP_ENTRY, data: loop });
if (cover) entries.push({ name: COVER_ENTRY, data: cover });
if (font) entries.push({ name: FONT_ENTRY, data: font });

// ---- The zip ------------------------------------------------------------
//
// Written by hand rather than with a library. A zip of four stored or
// deflated entries is a hundred lines and node already has the deflate; the
// alternative was a dependency, and this repo's .npmrc exists because the
// install is the fragile part of its builds. Not worth a package.

/** The table CRC-32 needs. Built once; every entry carries one of these. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Zip keeps a local time in the MS-DOS format: 1980-based, two second resolution. */
const dosStamp = (date) => {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

/**
 Builds the whole archive in memory and returns it with a line about each entry.

 Each member is offered to deflate and the result is kept only when it is
 actually smaller. mp4 and jpg are compressed already, so deflating them
 spends time to produce a bigger file; the manifest and a wav both shrink a
 long way. Zip is per-entry about this, so there is nothing to choose globally.

 No zip64. It would only matter past 4 GB, and a bundle that size is a
 different problem than a missing header.
 */
const buildZip = (members) => {
  const stamp = dosStamp(new Date());
  const chunks = [];
  const central = [];
  const report = [];
  let offset = 0;

  for (const { name, data } of members) {
    // The one rule the reader refuses the whole bundle over, checked against
    // the writer's own output rather than trusted to the code above.
    if (name.includes('/') || name.includes('\\')) {
      throw new Error(`entry name ${name} contains a path separator, which the format forbids`);
    }
    if (data.length > 0xffffffff) throw new Error(`${name} is over 4 GB, which needs zip64`);

    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const deflate = deflated.length < data.length;
    const stored = deflate ? deflated : data;
    const method = deflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 2.0 is the version that understands deflate
    local.writeUInt16LE(0x0800, 6); // the name is UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    chunks.push(local, nameBytes, stored);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // made by 2.0, MS-DOS, so no unix mode is recorded
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(stamp.time, 12);
    dir.writeUInt16LE(stamp.day, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(stored.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt16LE(0, 30); // no extra field
    dir.writeUInt16LE(0, 32); // no comment
    dir.writeUInt16LE(0, 34); // one disk, this one
    dir.writeUInt16LE(0, 36); // no internal attributes
    dir.writeUInt32LE(0, 38); // no external attributes: no directories, nothing executable
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);

    report.push({ name, method: deflate ? 'deflated' : 'stored', raw: data.length, stored: stored.length });
    offset += local.length + nameBytes.length + stored.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // the disk the directory starts on
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // no archive comment

  return { archive: Buffer.concat([...chunks, directory, end]), report };
};

// ---- Writing it out -----------------------------------------------------

/**
 The bundle's own file name, taken from the title.

 Only the characters a file system objects to are removed. Spaces stay: the
 store's own masters are named `New Deal- master.wav` and squashing the title
 into one word would be this script inventing a house style nobody asked for.
 */
const fileNameFor = (value) => {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\p{Cc}/gu, '') // control characters, which no file name should carry
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '') // a leading dot hides the file on every unix
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned === '' ? 'release' : cleaned;
};

const { archive, report } = buildZip(entries);

// Created if it is not there. A build step should not stop because the folder
// it writes into does not exist yet.
mkdirSync(outDir, { recursive: true });
const outPath = resolve(join(outDir, `${fileNameFor(title)}.om7`));
writeFileSync(outPath, archive);

for (const warning of warnings) console.warn(`warning: ${warning}`);
if (warnings.length > 0) console.warn('');

console.log(outPath);
for (const entry of report) {
  console.log(`  ${entry.name.padEnd(12)} ${entry.method.padEnd(9)} ${size(entry.stored).padStart(8)}`);
}
// The bundle is a little larger than its members added up: every entry carries
// a header, and the central directory is repeated at the end.
console.log(`  ${'bundle'.padEnd(12)} ${''.padEnd(9)} ${size(archive.length).padStart(8)}`);
