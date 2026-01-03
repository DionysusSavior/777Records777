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
- Default admin URL: `http://localhost:5173`
- Ensure `ADMIN_CORS` in `backend/.env` includes `http://localhost:5173`
