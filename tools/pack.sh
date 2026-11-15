#!/bin/sh
# Stamps the app with the time of packing, checks it, and makes the zip
# that is handed to people. Run from anywhere:
#
#   tools/pack.sh                 # writes dancing-with-the-sars.zip next to the repo
#   tools/pack.sh /some/where.zip
#
# The stamp shows at the end of the credits line in the app ("Version ...").
# Commit js/main.js and index.html afterwards so the hosted copy carries the
# same stamp.
set -e
cd "$(dirname "$0")/.."
STAMP="$(date -u '+%Y-%m-%d %H:%M UTC')"
OUT="${1:-../dancing-with-the-sars.zip}"
sed -i.bak "s/^const BUILD = '.*';/const BUILD = '$STAMP';/" js/main.js && rm -f js/main.js.bak
grep -q "const BUILD = '$STAMP';" js/main.js || { echo "could not stamp js/main.js"; exit 1; }
# The page asks for its script and its styles by version, so that a browser
# never pairs a new page with an older script from its cache (that happened
# on 15 November 2026: the older script stopped at a control the new page
# no longer had, and the globe came up without NISAR and without events).
VERSION="$(echo "$STAMP" | tr -cd '0-9')"
sed -i.bak -E "s/(js\/main\.js|css\/style\.css)\?v=[0-9]+/\1?v=$VERSION/g" index.html && rm -f index.html.bak
[ "$(grep -c "?v=$VERSION\"" index.html)" = 3 ] || { echo "could not stamp index.html"; exit 1; }
node --test tests/*.test.mjs >/dev/null || { echo "unit tests fail; not packing"; exit 1; }
rm -f "$OUT"
rm -rf tests/__pycache__ tools/__pycache__
zip -qr "$OUT" index.html css js vendor data demo docs tests tools README.md LICENSE .nojekyll start.bat start.sh start.command -x '*__pycache__*'
echo "packed version $STAMP into $OUT"
