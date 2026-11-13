#!/usr/bin/env bash
# Cuts a release: a PR bumps package.json, then the merge commit is tagged v<version>.
# Pushing the tag runs .github/workflows/release.yml, which builds and publishes the binaries.
set -euo pipefail

die() {
  echo "release: $*" >&2
  exit 1
}

version=${1:-}
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: scripts/release.sh <major.minor.patch>"
tag="v$version"
branch="chore/release-$tag"

cd "$(git rev-parse --show-toplevel)"
[[ -z $(git status --porcelain) ]] || die "working tree is not clean"
git fetch --quiet --tags origin main
[[ $(git rev-parse HEAD) == $(git rev-parse origin/main) ]] || die "HEAD is not origin/main; check out an up-to-date main"
! git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null || die "$tag already exists"

git switch --quiet -c "$branch"
bun pm pkg set version="$version"
git commit --quiet -am "chore: release $tag"
git push --quiet -u origin "$branch"
gh pr create --base main --head "$branch" --title "chore: release $tag" --body "Bumps the version to $version."

until [[ $(gh pr view "$branch" --json statusCheckRollup -q '.statusCheckRollup | length') -gt 0 ]]; do sleep 3; done
gh pr checks "$branch" --watch --fail-fast
gh pr merge "$branch" --squash --admin --delete-branch

git fetch --quiet origin main
git show origin/main:package.json | grep -q "\"version\": \"$version\"" ||
  die "origin/main does not have version $version"
git tag -a "$tag" -m "$tag" origin/main
git push --quiet origin "$tag"
git switch --quiet --detach origin/main
git branch --quiet -D "$branch" 2>/dev/null || true

echo "pushed $tag; follow the build with: gh run watch \$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')"
