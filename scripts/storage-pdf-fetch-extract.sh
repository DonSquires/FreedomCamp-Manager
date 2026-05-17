#!/usr/bin/env sh
set -eu

# Usage:
#   scripts/storage-pdf-fetch-extract.sh <bucket> <object_path> [output_stem]
# Example:
#   scripts/storage-pdf-fetch-extract.sh "Service-Contracts" "MDC-Documentation/26-007 Security & other Services RFIP- 24 03 2026 (1).PDF" "tmp/docs/rfip-26-007"

if [ "${1-}" = "" ] || [ "${2-}" = "" ]; then
  echo "Usage: $0 <bucket> <object_path> [output_stem]" >&2
  exit 1
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set" >&2
  exit 1
fi

bucket="$1"
object_path="$2"
out_stem="${3:-tmp/docs/storage-doc}"
out_pdf="${out_stem}.pdf"
out_txt="${out_stem}.txt"

mkdir -p "$(dirname "$out_stem")"

encoded_path="$(python3 - <<'PY' "$object_path"
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1], safe='/'))
PY
)"

url="${SUPABASE_URL%/}/storage/v1/object/authenticated/${bucket}/${encoded_path}"

echo "Downloading: ${bucket}/${object_path}"
curl -sS -L "$url" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -o "$out_pdf"

echo "Extracting text: $out_pdf -> $out_txt"
bunx pdf-parse text "$out_pdf" -o "$out_txt" >/dev/null

echo "Done"
echo "PDF: $out_pdf"
echo "TXT: $out_txt"
