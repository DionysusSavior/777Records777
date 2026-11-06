import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { readFileSync } from 'node:fs'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * TLS to the database, verified rather than merely encrypted.
 *
 * RDS sets rds.force_ssl=1 by default on postgres18, so an unencrypted
 * connection is refused and Medusa cannot start without this. Node does not
 * carry Amazon's RDS certificate authority, so the choice is to ship the CA
 * bundle or to stop checking the certificate; the image bakes the bundle in at
 * /etc/ssl/certs/rds-global-bundle.pem and this points the driver at it.
 *
 * Unset means untouched. Render supplies no such variable and keeps the
 * driver's own defaults, so this file behaves identically there - which
 * matters because a commit to this repository redeploys Render as well.
 *
 * Read at startup and allowed to throw. A missing or unreadable CA is a
 * misconfiguration that would otherwise surface as a connection error with no
 * mention of certificates, which is an afternoon lost to the wrong question.
 */
const caFile = process.env.DATABASE_SSL_CA_FILE?.trim()
const databaseDriverOptions = caFile
  ? {
      connection: {
        ssl: {
          ca: readFileSync(caFile, 'utf8'),
          rejectUnauthorized: true,
        },
      },
    }
  : undefined

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    ...(databaseDriverOptions ? { databaseDriverOptions } : {}),
    /**
     * Session storage only, in Medusa v2 - the cache, event bus and workflow
     * engine here are the in-memory defaults, because no module overrides them
     * below. One instance therefore loses nothing by having no Redis at all,
     * and the AWS deployment runs without one. Unset means in-memory sessions,
     * which drop on restart and sign admins out; that is the whole cost.
     */
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS || "",
      adminCors: process.env.ADMIN_CORS || "",
      authCors: process.env.AUTH_CORS || "",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  }
})
