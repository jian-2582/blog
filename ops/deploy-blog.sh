#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE=/var/lock/deploy-blog.lock
REPO_DIR=/opt/site-source
RELEASES_DIR=/srv/www/site/releases
CURRENT_LINK=/srv/www/site/current
KEEP_RELEASES=5
BRANCH=main
REMOTE=origin
REPO_URL=https://github.com/jian-2582/blog.git
CONTENT_ROOT=/opt/blog-content

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

export PATH="/usr/local/bin:/usr/bin:/bin"

if [ ! -d "${REPO_DIR}/.git" ]; then
  mkdir -p "$(dirname "${REPO_DIR}")"
  git clone "${REPO_URL}" "${REPO_DIR}"
fi

cd "${REPO_DIR}"
git remote set-url "${REMOTE}" "${REPO_URL}"
git fetch "${REMOTE}" "${BRANCH}"

LOCAL_REV="$(git rev-parse HEAD 2>/dev/null || true)"
REMOTE_REV="$(git rev-parse "${REMOTE}/${BRANCH}")"

if [ "${LOCAL_REV}" = "${REMOTE_REV}" ] && [ -L "${CURRENT_LINK}" ]; then
  exit 0
fi

git checkout -f "${BRANCH}"
git reset --hard "${REMOTE}/${BRANCH}"

if [ -d "${CONTENT_ROOT}/blog" ] && [ "$(find "${CONTENT_ROOT}/blog" -mindepth 1 -maxdepth 1 | wc -l)" -gt 0 ]; then
  mkdir -p "${REPO_DIR}/src/content/blog"
  rsync -a --delete "${CONTENT_ROOT}/blog/" "${REPO_DIR}/src/content/blog/"
fi

if [ -d "${CONTENT_ROOT}/projects" ] && [ "$(find "${CONTENT_ROOT}/projects" -mindepth 1 -maxdepth 1 | wc -l)" -gt 0 ]; then
  mkdir -p "${REPO_DIR}/src/content/projects"
  rsync -a --delete "${CONTENT_ROOT}/projects/" "${REPO_DIR}/src/content/projects/"
fi

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
