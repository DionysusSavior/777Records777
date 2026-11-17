// The `.om7` writer refuses what OM7Player refuses, and writes what it plays.
//
//   node --test scripts/make-om7-bundle.test.mjs
//
// Runs the script as an artist would, into a temporary folder, and reads the
// manifest back out of the zip it wrote. OM7_BUNDLE_SCRIPT points it at
// another copy of the script, which is how this was shown to fail against the
// version that still accepted .flac.
//
// When the music-metaverse checkout sits beside this one, as it does on Dion's
// Mac, the last test also reads the app's own list and says whether the two
// still agree. Elsewhere it is skipped, not failed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = process.env.OM7_BUNDLE_SCRIPT ?? join(here, 'make-om7-bundle.mjs');

/** What OM7Player plays: `Track.audioExtensions`, with the dot. */
const PLAYS = ['.mp3', '.mpeg', '.wav', '.aif', '.aiff', '.aifc', '.m4a', '.aac'];

/** Types an artist might export that the player has never listed. */
const REFUSED = ['.flac', '.caf', '.alac', '.ogg', '.opus', '.wma', '.om7', '.json'];

const scratch = () => mkdtempSync(join(tmpdir(), 'om7-bundle-test-'));

/** Runs the writer on a one-kilobyte song with the given name. */
const write = (songName, extra = []) => {
  const dir = scratch();
  const song = join(dir, songName);
  writeFileSync(song, Buffer.alloc(1024, 7));
  const out = join(dir, 'out');
  const run = spawnSync(process.execPath,
    [SCRIPT, '--audio', song, '--title', 'New Deal', '--artist', 'Dionysus Savior', '--out', out, ...extra],
    { encoding: 'utf8' });
  const written = existsSync(out) ? readdirSync(out) : [];
  return { dir, out, run, written };
};

/** The manifest, read from the first entry of the zip, which the writer always puts first. */
const manifestOf = (bundle) => {
  const zip = readFileSync(bundle);
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'starts with a local file header');
  const method = zip.readUInt16LE(8);
  const stored = zip.readUInt32LE(18);
  const nameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const name = zip.toString('utf8', 30, 30 + nameLength);
  assert.equal(name, 'om7.json');
  const start = 30 + nameLength + extraLength;
  const body = zip.subarray(start, start + stored);
  return JSON.parse((method === 8 ? inflateRawSync(body) : body).toString('utf8'));
};

for (const ext of PLAYS) {
  test(`a ${ext} song is written, under that type`, () => {
    const { dir, out, run, written } = write(`New Deal- master${ext}`);
    try {
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(written, ['New Deal.om7']);
      assert.equal(manifestOf(join(out, 'New Deal.om7')).audio, `audio${ext}`);
      assert.doesNotMatch(run.stderr, /--audio/, 'no warning about the song');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('the type is read without regard to case', () => {
  const { dir, run, written } = write('New Deal.WAV');
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(written, ['New Deal.om7']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const ext of REFUSED) {
  test(`a ${ext} song is refused and nothing is written`, () => {
    const { dir, run, written } = write(`New Deal${ext}`);
    try {
      assert.equal(run.status, 1);
      assert.match(run.stderr, new RegExp(`--audio is \\${ext}\\. OM7Player plays`));
      assert.match(run.stderr, /Nothing was written\./);
      assert.deepEqual(written, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('a WebP cover is kept without a word; a GIF is warned about and the bundle still written', () => {
  const dir = scratch();
  try {
    const song = join(dir, 'New Deal.wav');
    writeFileSync(song, Buffer.alloc(1024, 7));
    const art = (ext) => {
      const path = join(dir, `art${ext}`);
      writeFileSync(path, Buffer.alloc(64, 1));
      return path;
    };
    const run = (cover, out) => spawnSync(process.execPath,
      [SCRIPT, '--audio', song, '--title', 'New Deal', '--artist', 'Dionysus Savior', '--cover', cover, '--out', out],
      { encoding: 'utf8' });

    const kept = run(art('.webp'), join(dir, 'a'));
    assert.equal(kept.status, 0, kept.stderr);
    assert.doesNotMatch(kept.stderr, /--cover/);
    assert.equal(manifestOf(join(dir, 'a', 'New Deal.om7')).cover, 'cover.webp');

    const left = run(art('.gif'), join(dir, 'b'));
    assert.equal(left.status, 0, left.stderr);
    assert.match(left.stderr, /--cover is \.gif\. OM7Player keeps only .* and will leave this one out/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the writer's song list is the app's list", (t) => {
  const models = resolve(here, '../../music-metaverse/om7player/OM7Player/OM7Player/Models.swift');
  if (!existsSync(models)) {
    t.skip('music-metaverse is not beside this checkout');
    return;
  }
  const line = readFileSync(models, 'utf8').match(/static let audioExtensions: Set<String> = \[([^\]]*)\]/);
  assert.ok(line, 'Models.swift still declares Track.audioExtensions as a literal');
  const app = [...line[1].matchAll(/"([a-z0-9]+)"/g)].map((m) => `.${m[1]}`).sort();
  const script = readFileSync(SCRIPT, 'utf8').match(/const AUDIO_EXTENSIONS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(script, 'the script still declares AUDIO_EXTENSIONS as a literal');
  const writer = [...script[1].matchAll(/'(\.[a-z0-9]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(writer, app, 'change Track.audioExtensions and AUDIO_EXTENSIONS together');
  assert.deepEqual([...PLAYS].sort(), app, 'this test names the same list');
});
