# Site Manager framework handoff

## Outcome

The framework is built but deliberately not deployed, committed, or connected
to SwiftUI. It defines a versioned direct-publish protocol in OM7 and provides
777Records777's reference site implementation: the phone asks Medusa for a
short-lived, one-object S3 PUT, sends the file straight to the artist's bucket,
then asks Medusa to verify object headers and return the public URL.

OM7's Lambda was not changed. No OM7 bucket, table, media route, upload log,
queue, proxy, transcoder, or callback was added.

The prompt's anchors matched the checkout, with one semantic detail worth
making visible: `introUrl` and `introDownloadUrl` are HTTPS-only and capped at
500 characters, but `validate.mjs` does **not** enforce that their hostname
equals `verifiedDomain`. I treated “the artist's own host” as a protocol/deploy
rule and require the returned URL to derive from the artist backend's configured
public base. I did not silently add a Lambda hostname restriction, both because
the task forbids that file and because existing cards may deliberately use an
artist-controlled storage/CDN origin distinct from the storefront hostname.

## Files, one by one

### `~/Desktop/music-metaverse`

- `OM7-SITE-MANAGER.md` — the version 1 contract: existing domain trust,
  discovery, site-issued authentication, direct upload, progress, completion,
  stable failures, credential threat model, shared-hosting limits, and adapter
  seam.

The existing untracked `.claude/CODEX-SITE-MANAGER.md` is Dion's task prompt. I
read it and did not edit it.

### `~/Desktop/777Records777`

- `backend/src/site-manager/core.ts` — provider- and framework-neutral protocol
  validation, bearer-token verification, safe random keys, stateless signed
  receipts, and completion verification.
- `backend/src/site-manager/s3-adapter.ts` — 777's thin storage adapter. It
  creates one presigned S3 PUT and reads object headers with `HeadObject`; it
  never receives the upload body.
- `backend/src/site-manager/runtime.ts` — validates environment configuration
  and joins the protocol core to the S3 adapter.
- `backend/src/site-manager/http.ts` — converts known protocol failures to the
  public error shape and keeps storage/configuration details private.
- `backend/src/api/om7/site-manager/v1/uploads/route.ts` — Medusa begin route;
  accepts only small JSON and returns direct-upload instructions.
- `backend/src/api/om7/site-manager/v1/uploads/complete/route.ts` — Medusa
  completion route; verifies the signed receipt and stored object headers.
- `backend/src/site-manager/__tests__/core.unit.spec.ts` — covers the successful
  publish, bad credentials, unsafe/mismatched MIME types, untrusted filename,
  forged receipts, and stored-object mismatch.
- `backend/src/site-manager/__tests__/s3-adapter.unit.spec.ts` — proves the S3
  URL is for the expected bucket/key and cryptographically binds content
  length, MIME type, and SHA-256 headers.
- `storefront/src/app/.well-known/om7-site-manager.json/route.ts` — discovery on
  the artist's verified storefront domain, delegating to the Medusa endpoint.
- `backend/.env.template` — documents every Site Manager setting without a
  secret value.
- `render.yaml` — declares 777's non-secret limits/bucket and the secret values
  Render must receive before deployment.
- `backend/package.json` — makes the S3 client and presigner explicit direct
  dependencies.
- `package-lock.json` — records those two direct dependency declarations.
- `SITE-MANAGER-HANDOFF.md` — this review document.

## Why the design is this shape

### Existing domain proof is the only OM7 trust anchor

I rejected a new Site Manager verification row or role. OM7 already proves the
domain and gives the account a `manager` seat while explicitly withholding
ownership. The future app should enable Site Manager only from a card's exact
`verifiedDomain`, fetch discovery there, and leave the role unchanged.

This preserves the important manager/web-agency case. A person who controls a
site can publish to it without being declared the artist or card owner.

### The phone, not OM7, holds the site credential

I rejected storing S3 credentials or even the site publishing token in OM7.
That would place OM7 one credential/API call away from artist media and would
turn a directory compromise into a storage compromise.

The raw site token belongs in iOS Keychain. The artist backend stores only its
SHA-256 digest. For this framework 777 has one rotatable token; a proper admin
surface should later issue a separate token per device/person.

### A presigned one-object PUT, not multipart through Medusa

I rejected multipart form upload to the Medusa route because Medusa/Render
would receive every byte, large requests would consume application memory and
bandwidth, and progress would describe a proxy rather than the real storage
transfer.

The app instead uploads directly to the artist bucket. The presigned request is
bound to one random key, exact byte count, allowlisted MIME type, and SHA-256.
Both checksum and MIME headers are forced into AWS's signed-header set; this is
intentional because the default presigner otherwise hoists the checksum into
the query and leaves MIME unsigned.

### Stateless completion, not an upload table

I rejected a Medusa/OM7 upload-session table. The site signs the key, declared
headers, final URL, and expiry into an opaque receipt. Completion verifies the
signature, then `HeadObject` verifies the actual stored length/type/checksum.

This leaves no media catalog or abandoned session row. The tradeoff is that an
uploaded object whose caller never completes is not automatically removed;
the bucket should receive a prefix lifecycle rule if this becomes material.

### Random server key, not the phone's filename

The original filename is not used for the key. Besides collisions and path
traversal, accepting arbitrary extensions on a public same-origin media host
can create an executable HTML/SVG surface. The allowlisted MIME type chooses a
safe extension and a UUID chooses identity.

### Separate upload and completion lifetimes

The upload URL defaults to 15 minutes; its authorization is checked when a PUT
begins. The signed completion receipt defaults to 24 hours. I initially tied
both to the short lifetime, then rejected that during verification because a
large valid upload may finish after its PUT URL's start window.

### Single PUT, not resumable multipart yet

Version 1 is capped at 5 GiB, S3's single-PUT ceiling. Multipart introduces
part creation, completion, abort, retry state, and broader storage operations.
It should be a negotiated future capability if real uploads demonstrate the
need, not silent complexity in the first contract.

### Static-only hosting is honestly unsupported

I rejected putting a bearer or bucket key in static JavaScript: it is public to
every visitor. A static host needs a host-provided serverless function, a
delegated artist-controlled API origin named by its discovery file, or a manual
iOS share/export flow. FTP/WebDAV/cPanel master credentials do not belong in
OM7 as a workaround.

### Two AWS packages were added deliberately

`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` were already present
transitively through Medusa's file package, but importing undeclared transitive
dependencies is brittle. They are now direct backend dependencies at the
already-installed `3.964.0` line. Hand-writing SigV4 would create a security-
sensitive protocol implementation for no benefit.

## How the content boundary is enforced

The only request containing media bytes is the signed PUT URL returned by the
artist backend. Its hostname is the artist's configured storage provider. The
Medusa begin/complete routes accept JSON only; OM7's API has no Site Manager
route at all.

The core has no OM7 client, DynamoDB client, analytics hook, or listing method.
The storage interface exposes only:

- `issueUpload` — delegate one write;
- `inspectUpload` — read headers for that exact key.

The easiest future place to break the rule is the iOS implementation. If it
uploads to an OM7 URL first, reports the result to OM7, or sends filename/title/
checksum analytics, the server framework cannot save the boundary. The second
most likely break is adding multipart body parsing to the Medusa begin route.
Both should be rejected in review.

There is one narrow, intentional OM7-side result: the future client saves the
returned public audio links into the already-existing `introUrl` and
`introDownloadUrl` card fields named by the task. It sends no upload record,
filename, media kind, MIME type, length, or checksum to OM7. I interpreted the
brief's “do not record media metadata” rule this way because otherwise its
required first end-to-end use of those two existing URL fields would be
impossible. A reviewer who intends even the public URLs to remain local should
resolve that contradiction before SwiftUI work begins.

The future iOS change causes the app to send user-selected content to the
artist's chosen site. Under `AGENTS.md`, that change must update
`src/PrivacyPolicy.tsx` in the same commit after checking the wording against
the final code. This framework does not change OM7's current collection or
transmission behavior, so the policy was not edited here.

## What is not done

- No SwiftUI tab, navigation, sheet, picker, Keychain storage, hashing,
  `URLSession` upload task, or card save was written.
- No change was made to `infra/lambda/directory/index.mjs`, including the
  pending `publishDirectory()` work.
- No endpoint was added to OM7 and no second domain-proof concept was created.
- No production Render environment values were set and nothing was deployed.
- No live S3 upload was attempted.
- No token-issuance, QR, revocation list, or multiple-device admin UI exists.
- No per-token rate limit exists in this framework.
- No bucket IAM policy, public/CDN mapping, CORS policy, or lifecycle rule was
  created. These belong to the artist site's infrastructure, not OM7.
- No generated track/landing page exists. For audio the reference returns the
  same artist-controlled object URL as both `publicUrl` and `downloadUrl`.
- No media listing, editing, replacement, deletion, transcoding, thumbnailing,
  metadata database, or webhook exists.
- No automatic path exists for static-only shared hosting.
- No multipart/resumable upload exists above 5 GiB.
- Nothing was committed or pushed, per the task.

## Deployment work still required for 777

Before the endpoint can work in production, the site owner must:

1. Generate a high-entropy raw publishing token, put only its SHA-256 hex
   digest in `OM7_SITE_MANAGER_TOKEN_SHA256`, and transfer the raw token to the
   phone without placing it in source control or chat.
2. Generate an independent 32+ character receipt secret and set
   `OM7_SITE_MANAGER_RECEIPT_SECRET`.
3. Set `OM7_SITE_MANAGER_PUBLIC_BASE_URL` to the HTTPS public origin whose path
   maps exactly to keys in `777records777productpageassets`.
4. Give Render an AWS identity limited to `s3:PutObject` and `s3:GetObject`
   (needed by `HeadObject`) on
   `arn:aws:s3:::777records777productpageassets/site-manager/*`. Do not grant
   `s3:ListBucket`, delete, other prefixes, or other buckets.
5. Ensure the bucket/CDN exposes completed objects at the configured public
   base. Add a lifecycle rule for abandoned objects if desired.
6. Deploy both the storefront discovery route and backend routes, then perform
   the live direct-upload test below.

The Render secret names are declared in `render.yaml`, but their values are not
present anywhere in this tree.

## Exact verification commands

### What was run and passed

```bash
cd ~/Desktop/777Records777
npm --workspace backend run test:unit
npm run build:backend
npm run build:storefront
git diff --check

cd ~/Desktop/music-metaverse
node scripts/knowledge-lint.mjs
git diff --check
```

Results on 29 August 2026:

- 2 unit suites passed, 5 tests total.
- Medusa backend and embedded admin compiled successfully.
- Next storefront compiled successfully and listed
  `ƒ /.well-known/om7-site-manager.json` in its route artifact.
- `knowledge-lint` passed all 20 checkable OM7 claims.
- Both repositories passed `git diff --check`.

The storefront build printed its pre-existing inability to fetch product paths
without a running backend, then generated all static pages and exited 0. It also
printed the existing stale Browserslist and ambiguous Tailwind-class warnings.

### Local HTTP shell

With Postgres/Redis and the usual site environment configured:

```bash
cd ~/Desktop/777Records777
npm install
npm run dev:backend
```

In another terminal:

```bash
cd ~/Desktop/777Records777
npm run dev:storefront
curl -fsS http://localhost:8000/.well-known/om7-site-manager.json
```

The response must say `protocol: om7.site-manager`, `version: 1`, and point to
the local Medusa endpoint. Do not put a real publishing token directly in shell
history when exercising the authenticated routes.

### Production proof after secrets/IAM are configured

Use an expendable file and a test credential stored outside the repo:

1. Fetch `https://777records777.studio/.well-known/om7-site-manager.json` and
   verify its endpoint is HTTPS and is the intended Render backend.
2. Stream-hash the file to standard base64 SHA-256 and POST its kind, MIME,
   length, and checksum to `<endpoint>/uploads` with the site bearer token.
3. PUT the file directly to the returned URL with exactly the returned headers.
   Confirm the upload request's host is S3/the artist storage, not OM7 or
   Render.
4. POST the opaque receipt to `<endpoint>/uploads/complete`.
5. Fetch the returned `publicUrl`, verify its bytes hash to the original digest,
   and confirm the URL is under `OM7_SITE_MANAGER_PUBLIC_BASE_URL`.
6. Repeat with a wrong token, changed checksum header, changed MIME header,
   forged receipt, and oversized declared length. Each must fail with the
   documented code and must not produce a usable completion URL.

## Assumptions not verified from code or a live service

- `777records777productpageassets` is still the intended artist-controlled
  bucket for new Site Manager media.
- That bucket can return SHA-256 through `HeadObject` when the PUT supplied
  `x-amz-checksum-sha256`.
- A public origin or CDN can map `OM7_SITE_MANAGER_PUBLIC_BASE_URL` directly to
  the `site-manager/*` keys. I did not invent a value because the current code
  only proves an S3 URL exists, not the desired durable public origin.
- The Render backend can receive a new prefix-scoped AWS identity. Existing AWS
  credential scope was not inspected and no secret was read.
- The deployed storefront receives the correct `MEDUSA_BACKEND_URL` or
  `NEXT_PUBLIC_MEDUSA_BACKEND_URL`. The code currently falls back to
  `https://seven77records777.onrender.com`, but the live service was not queried.
- Native iOS direct PUTs need no bucket CORS change. A future web publisher
  would need explicit CORS for its own origin and returned headers.
- A 5 GiB single-PUT ceiling is enough for the first song/reel/video workflow.
- The future app can read a card's `verifiedDomain` from `/me` and can safely
  associate a Keychain item with the card/domain; that client path was not
  inspected or implemented here.
- Returning the raw public object as `downloadUrl` is acceptable for 777's
  first audio case. A site landing page would be better once the site has a
  real publish/catalog adapter.
- The intended reviewer will reconcile this work with any main-branch changes
  made after the prompt's verified line numbers. The anchors were re-read and
  matched in this checkout.
