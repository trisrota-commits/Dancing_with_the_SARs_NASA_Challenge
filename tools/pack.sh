#!/bin/sh
# Stamps the app with the time of packing, checks it, and makes the zip
# that is handed to people. Run from anywhere:
#
#   tools/pack.sh                 # writes dancing-with-the-sars.zip next to the repo
#   tools/pack.sh /some/where.zip
#
# The stamp shows at the end of the credits line in the app ("Version ...").
# Commit js/main.js afterwards so the hosted copy carries the same stamp.
set -e
cd "$(dirname "$0")/.."
STAMP="$(date -u '+%Y-%m-%d %H:%M UTC')"
OUT="${1:-../dancing-with-the-sars.zip}"
sed -i.bak "s/^const BUILD = '.*';/const BUILD = '$STAMP';/" js/main.js && rm -f js/main.js.bak
grep -q "const BUILD = '$STAMP';" js/main.js || { echo "could not stamp js/main.js"; exit 1; }
node --test tests/*.test.mjs >/dev/null || { echo "unit tests fail; not packing"; exit 1; }
rm -f "$OUT"
rm -rf tests/__pycache__ tools/__pycache__
zip -qr "$OUT" index.html css js vendor data demo docs tests tools README.md LICENSE .nojekyll start.bat start.sh start.command -x '*__pycache__*'
echo "packed version $STAMP into $OUT"
