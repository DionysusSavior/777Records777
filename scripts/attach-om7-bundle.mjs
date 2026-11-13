#!/usr/bin/env node
// Attach a built .om7 to a release that is already on the page.
//
//   node scripts/attach-om7-bundle.mjs --destination dionysus-savior-sounds \
//     --release <uuid> --file "In Time.om7" [--write]
//
// The phone does this through the studio service. This does the same thing
// from a laptop with the operator's own AWS identity, for a release whose
// parts were published before the phone built bundles. First used on
// 12 November 2026 for In Time. Build the file with make-om7-bundle.mjs. It calls the service's
// own commitCatalogue, so the manifest is what a real publish would have
// written, compare-and-swap and readability check included. Without --write
// it prints what it would do and touches nothing.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { applyCatalogue, commitCatalogue } = await import(`${REPO}/studio-service/src/catalogue.ts`);
const { destinationById, manifestLocationFor } = await import(`${REPO}/studio-service/src/destinations.ts`);
const { parseSiteManagerManifest } = await import(`${REPO}/storefront/src/lib/site-manager-manifest.ts`);

const arg = (name) => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1]; };
const write = process.argv.includes('--write');
const destination = destinationById(arg('destination'));
const releaseId = (arg('release') ?? '').toLowerCase();
const file = arg('file');
if (!destination || !/^[0-9a-f-]{36}$/.test(releaseId) || !file || !file.endsWith('.om7')) {
  console.error('usage: --destination <id> --release <uuid> --file <x.om7> [--write]'); process.exit(2);
}

const aws = (args, opts = {}) => execFileSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const who = aws(['sts', 'get-caller-identity', '--query', 'Arn', '--output', 'text']).trim();
if (who !== 'arn:aws:iam::639729144213:user/om7-cli') { console.error(`wrong identity: ${who}`); process.exit(2); }

const scratch = mkdtempSync(join(tmpdir(), 'om7-manifest-'));
const store = {
  async read(key) {
    const out = join(scratch, 'current.json');
    try {
      const head = JSON.parse(aws(['s3api', 'get-object', '--bucket', destination.bucket, '--key', key, out]));
      return { body: readFileSync(out, 'utf8'), etag: head.ETag };
    } catch (error) {
      if (String(error.stderr ?? '').includes('NoSuchKey')) return null;
      throw error;
    }
  },
  async write(key, body, ifMatch) {
    const next = join(scratch, 'next.json');
    writeFileSync(next, body);
    try {
      const put = JSON.parse(aws(['s3api', 'put-object', '--bucket', destination.bucket, '--key', key,
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

const bytes = readFileSync(file);
const downloadName = basename(file);
const key = `${destination.prefix}/${releaseId}.om7`;
const published = {
  key,
  publicUrl: new URL(key.split('/').map(encodeURIComponent).join('/'), destination.publicBaseUrl).toString(),
  mediaKind: 'bundle',
  contentType: 'application/octet-stream',
  contentLength: statSync(file).size,
  checksumSha256: createHash('sha256').update(bytes).digest('base64'),
  downloadName,
  title: downloadName.replace(/\.om7$/, ''),
  destinationId: destination.id,
  section: destination.section,
  releaseId,
};
const manifest = manifestLocationFor(destination);
const current = await store.read(manifest.key);
if (!current) { console.error('no manifest at', manifest.key); process.exit(1); }
const before = JSON.parse(current.body);
const release = (before.releases ?? []).find((r) => r.id === releaseId);
if (!release) { console.error('that release is not in the manifest'); process.exit(1); }

const publishedAt = new Date().toISOString();
const preview = applyCatalogue(current.body, published, publishedAt);
const readable = parseSiteManagerManifest(preview.body, manifest.url, 'store');
const after = JSON.parse(preview.body);
console.log('release      ', release.title, `(bundle was ${release.bundle})`);
console.log('object       ', `s3://${destination.bucket}/${key}`, published.contentLength, 'bytes');
console.log('manifest     ', manifest.url, 'etag', current.etag);
console.log('unchanged    ', preview.unchanged, '| site parser reads the result:', Boolean(readable));
console.log('release after', JSON.stringify(after.releases.find((r) => r.id === releaseId)));
console.log('new item     ', JSON.stringify(after.items.find((i) => i.kind === 'bundle')));
if (!readable) { console.error('refusing: the site would not read the result'); process.exit(1); }
if (!write) { console.log('\nDRY RUN. Nothing was written. Add --write to do it.'); process.exit(0); }

const disposition = `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
aws(['s3api', 'put-object', '--bucket', destination.bucket, '--key', key, '--body', file,
  '--content-type', published.contentType, '--content-disposition', disposition,
  '--checksum-algorithm', 'SHA256', '--checksum-sha256', published.checksumSha256]);
console.log('uploaded     ', published.publicUrl);
await commitCatalogue(store, manifest, published, publishedAt);
console.log('manifest committed');
