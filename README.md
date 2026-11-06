# 777records777

Medusa v2 monorepo with backend + Next.js storefront + self-hosted admin.

## Structure
- `backend/`: Medusa v2 server
- `storefront/`: Next.js storefront starter
- `admin/`: Medusa admin dashboard (Vite)

## Getting started
1. Copy `backend/.env.template` to `backend/.env` and fill values.
2. Ensure Postgres + Redis are running locally.
3. Install dependencies: `npm install`
4. Run backend: `npm run dev:backend`
5. Run storefront: `npm run dev:storefront`
6. Copy `admin/.env.template` to `admin/.env`
7. Run admin: `npm run dev:admin`

## Admin UI
- Dev admin URL: `http://localhost:5173`
- Production admin URL (embedded): `https://<storefront-domain>/admin`
- Ensure `ADMIN_CORS` in `backend/.env` includes the admin origin

## Amplify
The root `amplify.yml` builds the admin and embeds it under `storefront/public/admin`
before building the Next.js storefront. Set these Amplify env vars:
- `AMPLIFY_MONOREPO_APP_ROOT=storefront`
- `MEDUSA_BACKEND_URL=https://<your-backend-domain>`
- `MEDUSA_STOREFRONT_URL=https://<storefront-domain>`
- `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=<publishable-key-from-Medusa-Admin>`
- `NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://<your-backend-domain>`
- `NEXT_PUBLIC_BASE_URL=https://<storefront-domain>`

## Backend deployment (AWS)

The backend runs on ECS Fargate at `https://shop.777records777.studio`, with
Postgres on RDS. **It is not on Render**; commerce moved on 6 November 2026 and
`render.yaml` was deleted so that nobody can recreate the old service by
applying it as a Blueprint.

Infrastructure is one CDK stack in the sibling `music-metaverse` repository —
`infra/cdk/lib/commerce-stack.ts`, deployed by `bin/commerce.ts` rather than by
the default app, so a routine `cdk deploy` cannot touch the shop's database:

```
cd ../music-metaverse/infra/cdk
npx cdk -a "npx ts-node --prefer-ts-exts bin/commerce.ts" deploy
```

The container image is built in CodeBuild from a zip of `backend/`, not from a
local Dockerfile asset — see `infra/cdk/scripts/commerce-image.sh`. There is no
Docker on the machine this was set up from, and an image only one laptop can
rebuild is an image nobody else can.

What the stack supplies, so you do not set it by hand:
- `DATABASE_URL` is assembled by `backend/docker-entrypoint.sh` from values ECS
  injects from the RDS secret. TLS is required and verified against the RDS CA
  bundle baked into the image.
- `JWT_SECRET` and `COOKIE_SECRET` are generated into Secrets Manager.
- `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` and `MEDUSA_BACKEND_URL` are set in
  the task definition.
- S3 access and `ses:SendEmail` come from the task role. **No static access
  keys and no Resend key** — preorder mail goes through SES.
- There is no Redis. Medusa v2 uses `redisUrl` for session storage alone, and
  one task does not need it.

Migrations run in the container entrypoint on every start, so a deploy is the
migration.

- In Medusa Admin → Settings → API Keys, create a **Publishable** key and paste it into Amplify as `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` so the storefront build succeeds.
