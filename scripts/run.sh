#!/bin/bash
# Build the TypeScript in src/ and run one script from lib/ against the real
# Firebase project, authenticated as *you* through gcloud Application Default
# Credentials. No service-account key file is involved:
#
#   gcloud auth application-default login            # once per machine
#   ./run.sh -n grantAdminAccess                     # plus the env vars the
#                                                    # script's header documents
#
# Which database a script touches is decided by the script (FIRESTORE_DATABASE_ID,
# FIRESTORE_TEST_DATABASE_ID, SOURCE_DB/TARGET_DB); see README.md. Set
# GOOGLE_APPLICATION_CREDENTIALS yourself only if you really must use a key.
#
# Data exports do not live here any more: use the admin dashboard's
# All Registrations grid → Export (docs/admin-runbook.md, "Exports").
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 -n <scriptName>    (a file in src/, without .ts)"
  echo "Available:"
  ls src/*.ts | sed 's|src/||; s|\.ts$||; s|^|  |'
}

script_name=""
while getopts ":n:h" option; do
  case $option in
    n) script_name="$OPTARG" ;;
    h | \?) usage; exit 0 ;;
  esac
done

if [ -z "$script_name" ]; then
  usage
  exit 1
fi
if [ ! -f "src/${script_name}.ts" ]; then
  echo "No such script: src/${script_name}.ts" >&2
  usage
  exit 1
fi

# Never let a stale emulator setting redirect a production script.
unset FIRESTORE_EMULATOR_HOST
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-lyf-registration}"
mkdir -p output

yarn run build
exec node "lib/${script_name}.js"
