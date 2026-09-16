#!/usr/bin/env bash
# Fetch the anchor-gate corpus: ten public arXiv papers spanning the layouts that
# actually break PDF anchoring — single and two column, dense display maths, wide
# benchmark tables, rotated figure axis labels, and heavy use of ligatures and
# combining diacritics.
set -euo pipefail
cd "$(dirname "$0")/corpus/pdf"

PAPERS=(
  1706.03762  # Attention Is All You Need — single column, wide tables
  1810.04805  # BERT — two column, figure with rotated labels
  1512.03385  # ResNet — two column, dense benchmark tables
  1412.6980   # Adam — display maths throughout, stacked fractions
  2010.11929  # ViT — rotated axis labels, many plots
  1409.1556   # VGG — tight leading, long reference list
  1502.03167  # Batch Normalization — inline maths in prose
  1810.00826  # How Powerful are GNNs — theorem environments
  2203.02155  # InstructGPT — long appendices, verbatim transcripts
  1607.06450  # Layer Normalization — matrix displays, PUA delimiter glyphs
)

for id in "${PAPERS[@]}"; do
  if [ -f "$id.pdf" ]; then
    echo "have  $id.pdf"
  else
    echo "fetch $id.pdf"
    curl -sSL -A "keystone-dev/0.1 (anchor test corpus)" -o "$id.pdf" "https://arxiv.org/pdf/$id"
  fi
done
echo "corpus ready: $(ls -1 *.pdf | wc -l | tr -d ' ') papers"
