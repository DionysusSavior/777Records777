#!/bin/sh
set -e

# ECS injects database credentials as separate values, because a task
# definition can inject a whole secret or one JSON key of one and cannot
# compose a URL out of several. Medusa wants a single DATABASE_URL, so it is
# assembled here: in the container, at start, out of values that appear in no
# CloudFormation template and in no API response. DATABASE_URL set directly
# still wins, which is how this image runs against a local database.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${DB_HOST:-}" ]; then
  DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  export DATABASE_URL
fi

# Migrations run here, not in a deploy hook.
#
# Render had a preDeployCommand for this. ECS has no equivalent, and a one-off
# task somebody has to remember to run is how a schema drifts from the code
# that expects it. The service deploys one task at a time
# (minHealthyPercent 0), so two copies never migrate concurrently.
echo "entrypoint: running migrations"
npx medusa db:migrate

echo "entrypoint: starting medusa on port ${PORT}"
exec npx medusa start
