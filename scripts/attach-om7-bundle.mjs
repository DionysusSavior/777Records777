#!/usr/bin/env node
// Join one file to a release the way the phone does.
//
//   node scripts/attach-om7-bundle.mjs --destination dionysus-savior-sounds \
//     --release <uuid> --kind audio|reel|artwork|bundle \
//     (--file <local> | --source-key <key already in the bucket>) \
//     [--object-id <uuid>] [--title <name>] [--download-name <file>] [--write]
//
// `--kind` defaults to bundle, which is the original command: a local `.om7`
// onto a release that is already on the page. Audio may name a release that
// does not exist yet; that is how a song gets its title, so publish audio
// first. A reel, cover, or bundle on an unknown release is refused.
//
// `--source-key` copies inside the bucket. The WAV and the `.om7` for the
// catalogue songs already live at the bucket root, and copying them keeps
// the bytes instead of uploading a second copy of a 50 MB file. A reel that
// only exists inside a bundle is still a local `--file`.
//
// The phone does this through the studio service. This calls that service's
// own commitCatalogue, so the manifest is what a real publish would have
// written, compare-and-swap and readability check included. Without --write
// it prints what it would do and touches nothing.
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { applyCatalogue, commitCatalogue } = await import(`${REPO}/studio-service/src/catalogue.ts`);
const { destinationById, manifestLocationFor } = await import(`${REPO}/studio-service/src/destinations.ts`);
const { parseSiteManagerManifest } = await import(`${REPO}/storefront/src/lib/site-manager-manifest.ts`);

const arg = (name) => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1]; };
const write = process.argv.includes('--write');
const destination = destinationById(arg('destination'));
const releaseId = (arg('release') ?? '').toLowerCase();
const kind = arg('kind') ?? 'bundle';
const file = arg('file');
const sourceKey = arg('source-key');
const objectId = (arg('object-id') ?? '').toLowerCase();
const KINDS = new Set(['audio', 'reel', 'artwork', 'bundle']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTENT_TYPES = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.om7': 'application/octet-stream',
};

if (!destination || !UUID.test(releaseId) || !KINDS.has(kind) || (!file && !sourceKey) || (file && sourceKey)) {
  console.error('usage: --destination <id> --release <uuid> --kind audio|reel|artwork|bundle (--file <path> | --source-key <key>) [--object-id <uuid>] [--title <name>] [--download-name <file>] [--write]');
  process.exit(2);
}
if (kind === 'bundle' && file && !file.endsWith('.om7')) {
  console.error('a bundle is a .om7 file'); process.exit(2);
}
if (kind !== 'bundle' && !UUID.test(objectId)) {
  console.error('--object-id is the name the file is stored under, and it has to be a uuid'); process.exit(2);
}

const aws = (args, opts = {}) => execFileSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const who = aws(['sts', 'get-caller-identity', '--query', 'Arn', '--output', 'text']).trim();
if (who !== 'arn:aws:iam::639729144213:user/om7-cli') { console.error(`wrong identity: ${who}`); process.exit(2); }

const downloadName = arg('download-name') ?? basename(file ?? sourceKey);
const extension = extname(downloadName).toLowerCase();
const contentType = arg('content-type') ?? CONTENT_TYPES[extension];
if (!contentType) { console.error(`no content type for ${downloadName}; pass --content-type`); process.exit(2); }
const title = arg('title') ?? downloadName.replace(/\.[^.]+$/, '');

const hashRemote = (bucket, key) => new Promise((resolve, reject) => {
  const child = spawn('aws', ['s3', 'cp', `s3://${bucket}/${key}`, '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const hash = createHash('sha256');
  let size = 0;
  let err = '';
  child.stdout.on('data', (chunk) => { hash.update(chunk); size += chunk.length; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  child.on('close', (code) => code === 0
    ? resolve({ size, sha: hash.digest('base64') })
    : reject(new Error(err || `could not read s3://${bucket}/${key}`)));
});

const source = file
  ? { size: statSync(file).size, sha: createHash('sha256').update(readFileSync(file)).digest('base64') }
  : await hashRemote(destination.bucket, sourceKey);

const storedName = kind === 'bundle' ? `${releaseId}.om7` : `${objectId}${extension}`;
const key = `${destination.prefix}/${storedName}`;
const published = {
  key,
  publicUrl: new URL(key.split('/').map(encodeURIComponent).join('/'), destination.publicBaseUrl).toString(),
  mediaKind: kind,
  contentType,
  contentLength: source.size,
  checksumSha256: source.sha,
  downloadName,
  title,
  destinationId: destination.id,
  section: destination.section,
  releaseId,
};

const scratch = mkdtempSync(join(tmpdir(), 'om7-manifest-'));
const store = {
  async read(manifestKey) {
    const out = join(scratch, 'current.json');
    try {
      const head = JSON.parse(aws(['s3api', 'get-object', '--bucket', destination.bucket, '--key', manifestKey, out]));
      return { body: readFileSync(out, 'utf8'), etag: head.ETag };
    } catch (error) {
      if (String(error.stderr ?? '').includes('NoSuchKey')) return null;
      throw error;
    }
  },
  async write(manifestKey, body, ifMatch) {
    const next = join(scratch, 'next.json');
    writeFileSync(next, body);
    try {
      const put = JSON.parse(aws(['s3api', 'put-object', '--bucket', destination.bucket, '--key', manifestKey,
        '--body', next, '--content-type', 'application/json',
        '--cache-control', 'public, max-age=60, must-revalidate',
        ...(ifMatch === null ? ['--if-none-match', '*'] : ['--if-match', ifMatch])]));
      return { etag: put.ETag };
    } catch (error) {
      const text = String(error.stderr ?? '');
      if (text.includes('PreconditionFailed') || text.includes('ConditionalRequestConflict')) return { conflict: true };
      throw error;
    }
  },
};

const manifest = manifestLocationFor(destination);
const current = await store.read(manifest.key);
if (!current && kind !== 'audio') {
  console.error('no manifest yet. Publish the audio first, so the release is named after the song.');
  process.exit(1);
}
const before = current ? JSON.parse(current.body) : { releases: [] };
const release = (before.releases ?? []).find((item) => item.id === releaseId);
if (!release && kind !== 'audio') {
  console.error('that release is not in the manifest. Publish the audio first, so the release is named after the song.');
  process.exit(1);
}

const publishedAt = new Date().toISOString();
const preview = applyCatalogue(current?.body ?? null, published, publishedAt);
const readable = parseSiteManagerManifest(preview.body, manifest.url, 'store');
const after = JSON.parse(preview.body);
console.log('kind         ', kind, release ? `(release was ${release.title})` : '(new release)');
console.log('object       ', `s3://${destination.bucket}/${key}`, published.contentLength, 'bytes');
console.log('from         ', file ? file : `s3://${destination.bucket}/${sourceKey}`);
console.log('download     ', downloadName);
console.log('manifest     ', manifest.url, 'etag', current?.etag ?? '(new)');
console.log('unchanged    ', preview.unchanged, '| site parser reads the result:', Boolean(readable));
console.log('release after', JSON.stringify(after.releases.find((item) => item.id === releaseId)));
if (!readable) { console.error('refusing: the site would not read the result'); process.exit(1); }
if (!write) { console.log('\nDRY RUN. Nothing was written. Add --write to do it.'); process.exit(0); }

const disposition = `attachment; filename="${downloadName.replaceAll('"', '')}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
if (sourceKey) {
  aws(['s3api', 'copy-object', '--bucket', destination.bucket, '--key', key,
    '--copy-source', `${destination.bucket}/${sourceKey}`,
    '--content-type', contentType, '--content-disposition', disposition,
    '--metadata-directive', 'REPLACE', '--checksum-algorithm', 'SHA256']);
} else {
  aws(['s3api', 'put-object', '--bucket', destination.bucket, '--key', key, '--body', file,
    '--content-type', contentType, '--content-disposition', disposition,
    '--checksum-algorithm', 'SHA256', '--checksum-sha256', source.sha]);
}
console.log('uploaded     ', published.publicUrl);
await commitCatalogue(store, manifest, published, publishedAt);
console.log('manifest committed');
