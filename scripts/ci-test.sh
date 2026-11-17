#!/usr/bin/env bash
# The shop's tests and typecheck, run by the Amplify build before `next build`.
# A failure here stops the deploy and the site that is live stays as it was.
#
#   bash scripts/ci-test.sh          (from anywhere; amplify.yml runs it)
#
# WHY IN THE SHOP'S BUILD. studio-service reads the storefront's own data
# (`storeItemsFor` imports storefront/src/lib/artists.ts), so an edit to that
# data can break a service test. On 14 Nov one did, and the test and the
# typecheck stayed red for three days, because nothing ran them: Amplify built
# and deployed the shop without either. Found 17 Nov.
#
# WHY NODE 22 HERE AND NOT FOR THE BUILD. The tests are TypeScript run by
# node directly, which needs Node 22.18 (or 23.6) or later. Amplify's default
# image ships an older Node, and switching the whole build to a new one would
# change what `next build` runs on - a different risk from the one this file
# exists for.
# So when the Node in front of it is too old, this script switches to 22
# through nvm (which the Amplify image carries) inside its own process. The
# build's shell, and so `next build`, keep the Node they had.
set -euo pipefail
cd "$(dirname "$0")/.."

new_enough() {
  # Type stripping without a flag: 22.18 on the 22 line, 23.6 on the 23 line.
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a >= 24 || (a === 23 && b >= 6) || (a === 22 && b >= 18) ? 0 : 1)'
}

echo "ci-test: node $(node --version) on the build"
if ! new_enough; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "ci-test: this Node cannot run the TypeScript tests, and there is no nvm at $NVM_DIR to fetch Node 22." >&2
    exit 1
  fi
  # nvm is not written for `set -eu`: it reads unset variables and lets
  # internal commands fail on purpose. Off for nvm, then checked by hand.
  set +eu
  . "$NVM_DIR/nvm.sh"
  nvm install 22 >/dev/null
  nvm use 22 >/dev/null
  set -eu
  if ! new_enough; then
    echo "ci-test: nvm did not leave a Node that can run the tests (have $(node --version))." >&2
    exit 1
  fi
  echo "ci-test: tests run on node $(node --version), in this process only"
fi

# NODE_ENV is production on Amplify, and npm then skips devDependencies:
# studio-service's typecheck needs typescript and @types/node from there.
npm ci --prefix studio-service --include=dev --no-audit --no-fund

npm test
npm run typecheck
echo "ci-test: tests and typecheck passed"
