#!/usr/bin/env bash
# Re-fetch the PDFs and LaTeX sources for every paper the library already analyses.
#
# The dossiers in apps/web/public/dossiers are the committed artefact — the app runs
# from them with no corpus on disk at all. This is for *rebuilding* them: change the
# lineage layer and you need the sources back.
#
# The paper list comes from the committed index rather than being written out here, so
# it cannot drift from what the library actually contains. To add papers, use
# `keystone expand`, which picks them by what the library already cites.
set -uo pipefail
cd "$(dirname "$0")"

INDEX=../apps/web/public/dossiers/index.json
if [ ! -f "$INDEX" ]; then
  echo "no dossier index at $INDEX" >&2
  exit 1
fi

IDS=$(python3 -c "
import json, sys
print(' '.join(e['id'] for e in json.load(open('$INDEX'))))
")
TOTAL=$(echo "$IDS" | wc -w | tr -d ' ')
echo "library: $TOTAL papers"

mkdir -p corpus/pdf corpus/cache/eprints
have=0
fetched=0
failed=()

for id in $IDS; do
  pdf="corpus/pdf/$id.pdf"
  src="corpus/cache/eprints/$id.eprint"

  if [ -s "$pdf" ] && [ -s "$src" ]; then
    have=$((have + 1))
    continue
  fi

  # arXiv asks for roughly one request every three seconds from bulk clients, and each
  # paper here is two requests. Going faster earns HTTP 406 responses that read as
  # "this paper has no source" and are nothing of the kind.
  [ -s "$pdf" ] || curl -sSL --retry 4 --retry-delay 4 \
    -A "keystone/0.1 (+https://github.com/Srikarmk/Keystone)" \
    -o "$pdf" "https://arxiv.org/pdf/$id" || true
  sleep 3
  [ -s "$src" ] || curl -sSL --retry 4 --retry-delay 4 \
    -A "keystone/0.1 (+https://github.com/Srikarmk/Keystone)" \
    -o "$src" "https://arxiv.org/e-print/$id" || true
  sleep 3

  if [ -s "$pdf" ] && [ -s "$src" ]; then
    fetched=$((fetched + 1))
    echo "fetch $id"
  else
    failed+=("$id")
    echo "FAIL  $id" >&2
  fi
done

echo "had $have, fetched $fetched, failed ${#failed[@]}"
[ ${#failed[@]} -eq 0 ] || printf '  %s\n' "${failed[@]}" >&2

cat <<'NEXT'

Rebuild the dossiers with:
  cd services/core && uv run keystone dossier $(python3 -c "
import json;print(' '.join(e['id'] for e in json.load(open('../../apps/web/public/dossiers/index.json'))))")
NEXT
