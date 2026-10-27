#!/bin/bash
# Seeds the Firestore emulator with test admin data, the config/site pointer
# and sample camps/{year} documents so the registration pages resolve their
# schedule. Run this AFTER `firebase emulators:start` is up.
#
# Usage: ./scripts/seed-emulator.sh [email]
# Default email: test@tacl.org

FIRESTORE_HOST="http://127.0.0.1:8080"
PROJECT_ID="${FIREBASE_PROJECT_ID:-lyf-registration}"
# v2 data lives in a named database; "(default)" belongs to v1
DATABASE_ID="${FIRESTORE_DATABASE_ID:-lyf-v2}"
EMAIL="${1:-test@tacl.org}"

# "Bearer owner" bypasses all Firestore security rules in the emulator
AUTH_HEADER="Authorization: Bearer owner"

echo "Seeding Firestore emulator at $FIRESTORE_HOST..."

# Create admin document
curl -s -X PATCH \
  "${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/admins/${EMAIL}?updateMask.fieldPaths=role&updateMask.fieldPaths=addedBy" \
  -H "Content-Type: application/json" \
  -H "${AUTH_HEADER}" \
  -d "{
    \"fields\": {
      \"role\": { \"stringValue\": \"full_admin\" },
      \"addedBy\": { \"stringValue\": \"seed-script\" }
    }
  }" > /dev/null

echo "  ✔ Created admins/${EMAIL} with role: full_admin"

# Create a second admin with program_staff role for testing
STAFF_EMAIL="staff@tacl.org"
curl -s -X PATCH \
  "${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/admins/${STAFF_EMAIL}?updateMask.fieldPaths=role&updateMask.fieldPaths=addedBy" \
  -H "Content-Type: application/json" \
  -H "${AUTH_HEADER}" \
  -d "{
    \"fields\": {
      \"role\": { \"stringValue\": \"program_staff\" },
      \"addedBy\": { \"stringValue\": \"seed-script\" }
    }
  }" > /dev/null

echo "  ✔ Created admins/${STAFF_EMAIL} with role: program_staff"

# Create a third admin with health_staff role for testing
HEALTH_EMAIL="health@tacl.org"
curl -s -X PATCH \
  "${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/admins/${HEALTH_EMAIL}?updateMask.fieldPaths=role&updateMask.fieldPaths=addedBy" \
  -H "Content-Type: application/json" \
  -H "${AUTH_HEADER}" \
  -d "{
    \"fields\": {
      \"role\": { \"stringValue\": \"health_staff\" },
      \"addedBy\": { \"stringValue\": \"seed-script\" }
    }
  }" > /dev/null

echo "  ✔ Created admins/${HEALTH_EMAIL} with role: health_staff"

# Create a fourth admin with program_admin role (program_staff + camp year rollover)
PROGRAM_ADMIN_EMAIL="programadmin@tacl.org"
curl -s -X PATCH \
  "${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/admins/${PROGRAM_ADMIN_EMAIL}?updateMask.fieldPaths=role&updateMask.fieldPaths=addedBy" \
  -H "Content-Type: application/json" \
  -H "${AUTH_HEADER}" \
  -d "{
    \"fields\": {
      \"role\": { \"stringValue\": \"program_admin\" },
      \"addedBy\": { \"stringValue\": \"seed-script\" }
    }
  }" > /dev/null

echo "  ✔ Created admins/${PROGRAM_ADMIN_EMAIL} with role: program_admin"

# ---- Site config and camp years ----
# config/site points the website at the current and pre-registration years;
# camps/{year} carries the dates the time gates read. Every file in
# scripts/camp-years/ (one per year, reconstructed from the v1 repo's history)
# is written as-is, with remainingSpots reset to campSizeCaps. In production
# these are edited from the admin dashboard's Camp Year tab (manageCampYear).
DOCS_URL="${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents"
CURRENT_YEAR="${CAMP_YEAR:-2026}"
PREREG_YEAR="${PREREG_CAMP_YEAR:-$((CURRENT_YEAR + 1))}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

put_doc() {
  # PATCH without an updateMask replaces the whole document.
  curl -s -X PATCH "${DOCS_URL}/$1" \
    -H "Content-Type: application/json" \
    -H "${AUTH_HEADER}" \
    -d "$2" > /dev/null
}

# Converts a camp-years/{year}.json file into the Firestore REST document shape.
camp_year_doc() {
  node -e '
    const raw = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;
    const enc = (v) =>
      typeof v === "string" ? (iso.test(v) ? { timestampValue: new Date(v).toISOString() } : { stringValue: v })
      : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
      : typeof v === "boolean" ? { booleanValue: v }
      : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
      : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
    const fields = {};
    for (const [k, v] of Object.entries(raw)) {
      // Bypass emails are private per-email documents, never on the public doc.
      if (k.startsWith("_") || k === "registrationBypassEmails") continue;
      fields[k] = enc(v);
    }
    if (raw.campSizeCaps) fields.remainingSpots = enc(raw.campSizeCaps);
    process.stdout.write(JSON.stringify({ fields }));
  ' "$1"
}

bypass_emails() {
  node -e 'console.log((JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).registrationBypassEmails || []).join("\n"))' "$1"
}

for file in "${SCRIPT_DIR}"/camp-years/*.json; do
  year="$(basename "${file}" .json)"
  put_doc "camps/${year}" "$(camp_year_doc "${file}")"
  echo "  ✔ Created camps/${year} from $(basename "${file}")"
  for email in $(bypass_emails "${file}"); do
    put_doc "camps/${year}/private/bypass/emails/${email}" "{
      \"fields\": {
        \"email\": $(str "${email}"),
        \"addedBy\": $(str "seed-script")
      }
    }"
    echo "    ✔ bypass entry ${email}"
  done
done

put_doc "config/site" "{
  \"fields\": {
    \"currentCampYear\": { \"integerValue\": \"${CURRENT_YEAR}\" },
    \"preRegistrationCampYear\": { \"integerValue\": \"${PREREG_YEAR}\" },
    \"updatedBy\": { \"stringValue\": \"seed-script\" }
  }
}"
echo "  ✔ Created config/site (current: ${CURRENT_YEAR}, pre-registration: ${PREREG_YEAR})"

echo ""
echo "Done! Sign in with any of these emails via the Auth emulator:"
echo "  - ${EMAIL} (full_admin)"
echo "  - ${STAFF_EMAIL} (program_staff)"
echo "  - ${HEALTH_EMAIL} (health_staff)"
echo "  - ${PROGRAM_ADMIN_EMAIL} (program_admin)"
