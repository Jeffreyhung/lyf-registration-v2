#!/bin/bash
# Seeds the Firestore emulator with test admin data.
# Run this AFTER `firebase emulators:start` is up.
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

echo ""
echo "Done! Sign in with any of these emails via the Auth emulator:"
echo "  - ${EMAIL} (full_admin)"
echo "  - ${STAFF_EMAIL} (program_staff)"
echo "  - ${HEALTH_EMAIL} (health_staff)"
echo "  - ${PROGRAM_ADMIN_EMAIL} (program_admin)"
