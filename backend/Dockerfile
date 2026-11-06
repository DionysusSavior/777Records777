# syntax=docker/dockerfile:1

# Base images come from the Amazon ECR public mirror rather than Docker Hub.
# CodeBuild builds from a shared pool of egress addresses and Docker Hub rate
# limits them, so a Hub-sourced FROM fails intermittently with 429 and reads
# like a flaky build rather than like a quota.
FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS build

WORKDIR /app

# package.json alone first, so a source-only change reuses the dependency
# layer.
#
# There is deliberately no package-lock.json copied: there is none in this
# directory. The lockfile lives at the repository root for the npm workspace,
# and this build context is the backend on its own. `npm install` therefore
# resolves fresh - which is exactly what Render's build command does today, so
# moving the build here does not change the dependency set.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .

# Medusa v2 builds to .medusa/server: a self-contained server directory with
# its own package.json, with the admin dashboard compiled into it. It is NOT
# the source tree with a dist folder, and its production dependencies are
# installed INSIDE it - which is why this is an install of its own rather than
# a copy of the node_modules above.
RUN npx medusa build \
 && cd .medusa/server \
 && npm install --omit=dev --no-audit --no-fund


FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
# Medusa reads PORT. Render injected 10000 and nothing outside the task cares
# which it is now, so this is Medusa's own default and the ALB's target port.
ENV PORT=9000

# The Amazon RDS certificate authority bundle, baked in so TLS to the database
# is VERIFIED and not merely encrypted. RDS sets rds.force_ssl=1 by default on
# postgres18, so a plaintext connection is refused outright - but Node does not
# trust Amazon's RDS CA out of the box, so without this the only ways to
# connect are to ship the bundle or to turn verification off. Shipping it is
# the one that still detects an impostor.
#
# medusa-config.ts reads the path from DATABASE_SSL_CA_FILE and leaves SSL
# alone when it is unset, which is why adding this breaks no other deployment.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
RUN chmod 0444 /etc/ssl/certs/rds-global-bundle.pem

WORKDIR /app
COPY --from=build /app/.medusa/server ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Not root. Nothing in this stage builds anything, and the server writes
# nothing under /app at runtime.
USER node

EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
