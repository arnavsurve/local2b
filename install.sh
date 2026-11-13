#!/bin/sh
# Installs the l2b release binary for this machine and the agent skill.
#   curl -fsSL https://raw.githubusercontent.com/arnavsurve/local2b/main/install.sh | sh
# L2B_VERSION pins a release (default: latest). L2B_INSTALL_DIR sets the directory (default: ~/.local/bin).
set -eu

REPO=arnavsurve/local2b

die() {
  echo "l2b install: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "unsupported OS: $(uname -s) (releases cover macOS and Linux)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die "unsupported CPU: $(uname -m) (releases cover arm64 and x64)" ;;
esac
# A shell under Rosetta reports x86_64 on Apple silicon; the native binary is the right one.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
  arch=arm64
fi

asset="l2b-$os-$arch"
if [ -n "${L2B_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/v${L2B_VERSION#v}"
else
  base="https://github.com/$REPO/releases/latest/download"
fi

command -v curl >/dev/null 2>&1 || die "curl is required"
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  die "sha256sum or shasum is required"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

curl -fsSL -o "$tmp/$asset" "$base/$asset" || die "download failed: $base/$asset"
curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" || die "download failed: $base/SHA256SUMS"
expected=$(awk -v f="$asset" '$2 == f { print $1 }' "$tmp/SHA256SUMS")
[ -n "$expected" ] || die "SHA256SUMS has no entry for $asset"
actual=$(sha256 "$tmp/$asset")
[ "$actual" = "$expected" ] || die "checksum mismatch for $asset: expected $expected, got $actual"

dir="${L2B_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir"
chmod 755 "$tmp/$asset"
mv -f "$tmp/$asset" "$dir/l2b"
if [ "$os" = darwin ]; then
  xattr -d com.apple.quarantine "$dir/l2b" 2>/dev/null || true
fi

echo "installed $dir/l2b ($("$dir/l2b" --version))"
"$dir/l2b" install
