#!/usr/bin/env sh
# Assemble a versioned, native FlowStudio developer-preview archive.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
test -f VERSION || { echo "Missing VERSION" >&2; exit 1; }
version=$(cat VERSION)
case "$version" in
  ''|*[!0-9A-Za-z.+-]*) echo "Invalid VERSION" >&2; exit 1 ;;
esac
test -x build/flowstudio || { echo "Build and verify build/flowstudio first" >&2; exit 1; }
platform=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$platform-$arch" in
  linux-x86_64|darwin-arm64) ;;
  *) echo "Unsupported release target: $platform-$arch" >&2; exit 1 ;;
esac
mkdir -p dist
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
name="flowstudio-$version"
mkdir -p "$stage/$name/bin"
cp build/flowstudio "$stage/$name/bin/flowstudio"
cp -R web "$stage/$name/web"
cp -R docs "$stage/$name/docs"
mkdir -p "$stage/$name/src"
cp src/python_kernel.py "$stage/$name/src/python_kernel.py"
cp VERSION README.md "$stage/$name/"
if test -f LICENSE; then cp LICENSE "$stage/$name/"; fi
cat > "$stage/$name/run.sh" <<'EOS'
#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec ./bin/flowstudio
EOS
chmod +x "$stage/$name/run.sh"
out="dist/$name-$platform-$arch.tar.gz"
tar -czf "$out" -C "$stage" "$name"
echo "Packaged $out"
