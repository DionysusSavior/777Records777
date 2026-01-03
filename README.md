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

## Render deployment (backend)
- In Render, create managed Postgres (grab `DATABASE_URL`) and managed Redis (grab `REDIS_URL`).
- Add a new Web Service from this repo and let it pick up `render.yaml`.
  - Build: `npm install && npm run build:backend`
  - Start: `npm --workspace backend run start`
  - Health check: `/health`
- Set env vars on the service:
  - `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `COOKIE_SECRET` (mark secrets as private)
  - `STORE_CORS=https://777records777.studio`
  - `ADMIN_CORS=https://777records777.studio/admin,http://localhost:9000/app`
  - `MEDUSA_BACKEND_URL=https://<your-render-service>.onrender.com`
- After first deploy, seed data once from the Render shell:
  - `npm run seed --workspace backend`
- In Medusa Admin → Settings → API Keys, create a **Publishable** key and paste it into Amplify as `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` so the storefront build succeeds.
