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
