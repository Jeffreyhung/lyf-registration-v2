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
# camps/{year} carries the dates the time gates read. The two years below are
# sample data following the usual calendar (pre-registration during the
# previous summer, early registration late January, general mid-February,
# close in April, camp in July). In production these are edited from the
# admin dashboard's Camp Year tab (manageCampYear function).
DOCS_URL="${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents"
CURRENT_YEAR="${CAMP_YEAR:-2026}"
PREREG_YEAR="${PREREG_CAMP_YEAR:-$((CURRENT_YEAR + 1))}"

put_doc() {
  # PATCH without an updateMask replaces the whole document.
  curl -s -X PATCH "${DOCS_URL}/$1" \
    -H "Content-Type: application/json" \
    -H "${AUTH_HEADER}" \
    -d "$2" > /dev/null
}

ts() { echo "{ \"timestampValue\": \"$1\" }"; }
int() { echo "{ \"integerValue\": \"$1\" }"; }
str() { echo "{ \"stringValue\": \"$1\" }"; }

# A full camps/{year} document for year $1 (times are UTC for Pacific noon/midnight).
camp_year_doc() {
  local y="$1" prev=$(( $1 - 1 ))
  cat <<JSON
{
  "fields": {
    "name": $(str "LYF Camp ${y}"),
    "campsite": $(str "Alliance Redwoods Conference Grounds"),
    "campsiteAddress": $(str "6250 Bohemian Hwy, Occidental, CA 95465"),
    "preRegistrationOpenDate": $(ts "${prev}-07-12T22:00:00Z"),
    "preRegistrationCloseDate": $(ts "${prev}-08-04T07:00:00Z"),
    "earlyRegOpenDate": $(ts "${y}-01-31T20:00:00Z"),
    "earlyRegEndDate": $(ts "${y}-02-14T20:00:00Z"),
    "registrationOpenDate": $(ts "${y}-02-15T20:00:00Z"),
    "registrationLateDate": $(ts "${y}-03-31T19:00:00Z"),
    "registrationCloseDate": $(ts "${y}-04-20T07:00:00Z"),
    "infoSessionDate": $(ts "${y}-02-04T03:00:00Z"),
    "campStartDate": $(ts "${y}-07-12T22:00:00Z"),
    "campEndDate": $(ts "${y}-07-18T22:00:00Z"),
    "preRegistrationFee": $(int 500),
    "registrationFee": $(int 1325),
    "registrationLateFee": $(int 1525),
    "shirtPrice": $(int 0),
    "siblingDiscount": $(int 0),
    "campTotalSizeCap": $(int 185),
    "campSizeCaps": { "mapValue": { "fields": { "Younger": $(int 85), "Older": $(int 85) } } },
    "remainingSpots": { "mapValue": { "fields": { "Younger": $(int 85), "Older": $(int 85) } } }
  }
}
JSON
}

for year in "${CURRENT_YEAR}" "${PREREG_YEAR}"; do
  put_doc "camps/${year}" "$(camp_year_doc "${year}")"
  echo "  ✔ Created camps/${year}"
done

# One sample registration-close bypass entry (private per-email document) so
# the gate's bypass path can be exercised locally.
BYPASS_EMAIL="latecomer@example.com"
put_doc "camps/${CURRENT_YEAR}/private/bypass/emails/${BYPASS_EMAIL}" "{
  \"fields\": {
    \"email\": $(str "${BYPASS_EMAIL}"),
    \"addedBy\": $(str "seed-script")
  }
}"
echo "  ✔ Created camps/${CURRENT_YEAR}/private/bypass/emails/${BYPASS_EMAIL}"

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
