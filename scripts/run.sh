#!/bin/bash

# Data exports (camper addresses for mailings, parent / pre-registration email
# lists, per-camper parent emails) no longer live here. Use the admin
# dashboard's All Registrations grid instead: filter, pick columns, then
# Export -> CSV. See "Exports" under "Admin dashboard" in the root README.
# The scripts that remain are one-off migrations, seeding and statistics.

# Add the path to the private key that enables the Admin SDK
export GOOGLE_APPLICATION_CREDENTIALS="../lyf-registration-firebase-admin-private-key.json"
unset FIRESTORE_EMULATOR_HOST

echo "Running firebase script..."

script_name=""

while getopts ":t:n:h" option; do
  case $option in
    t)
      # firebase emulators:start
      # export FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
      echo "Test mode is broken right now oops"
      ;;
    n)
      script_name="$OPTARG"
      ;;
    h|\?)
      echo "Usage: $0 [-t] [-n name]"
      exit 0
      ;;
  esac
done
# Build the TypeScript files
yarn run build

# Run the script in the lib directory
node lib/"$script_name".js
