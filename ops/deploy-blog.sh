#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE=/var/lock/deploy-blog.lock
REPO_DIR=/opt/site-source
RELEASES_DIR=/srv/www/site/releases
CURRENT_LINK=/srv/www/site/current
KEEP_RELEASES=5
BRANCH=main
REMOTE=origin
SSH_KEY=/root/.ssh/blog_github_ed25519

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

export PATH="/usr/local/bin:/usr/bin:/bin"
export GIT_SSH_COMMAND="ssh -i ${SSH_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"

if [ ! -d "${REPO_DIR}/.git" ]; then
  mkdir -p "$(dirname "${REPO_DIR}")"
  git clone git@github.com:jian-2582/blog.git "${REPO_DIR}"
fi

cd "${REPO_DIR}"
git fetch "${REMOTE}" "${BRANCH}"

LOCAL_REV="$(git rev-parse HEAD 2>/dev/null || true)"
REMOTE_REV="$(git rev-parse "${REMOTE}/${BRANCH}")"

if [ "${LOCAL_REV}" = "${REMOTE_REV}" ] && [ -L "${CURRENT_LINK}" ]; then
  exit 0
fi

git checkout -f "${BRANCH}"
git reset --hard "${REMOTE}/${BRANCH}"
npm ci
npm run build

RELEASE_ID="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"

mkdir -p "${RELEASE_DIR}"
rsync -a --delete dist/ "${RELEASE_DIR}/"
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

chown -h caddy:caddy "${CURRENT_LINK}"
chown -R caddy:caddy "${RELEASE_DIR}"
chmod -R o=rX "${RELEASE_DIR}"

find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d | sort | head -n -"${KEEP_RELEASES}" | xargs -r rm -rf

systemctl reload caddy
