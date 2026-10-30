# Deployment

Everything deploys from GitHub Actions on merge to `main`. Pull requests only run
CI (`ci.yml`, `test-firestore-rules.yml`); nothing is deployed from a PR.

| Workflow                                                        | Deploys                                                    | Triggered by                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [deploy-website.yml](../.github/workflows/deploy-website.yml)   | Gatsby site → GitHub Pages                                 | every push to `main`                                                                 |
| [deploy-firebase.yml](../.github/workflows/deploy-firebase.yml) | Cloud Functions (`v2` codebase), Firestore rules + indexes | pushes to `main` that touch `functions/`, `schemas/`, `firestore.*`, `firebase.json` |

Both can also be run by hand from the Actions tab (`workflow_dispatch`). The
Firebase workflow only deploys the parts whose files changed; the manual run
has checkboxes to pick functions and/or Firestore.

## GitHub Pages

Repository **Settings → Pages → Source** must be set to _GitHub Actions_. The
build reads the `GATSBY_FIREBASE_*` secrets listed in the workflow and the
optional `GATSBY_CUSTOM_DOMAIN` repository variable (set it to serve from a
custom domain at the site root; leave it unset to serve from
`<owner>.github.io/<repo>` with prefixed asset paths).

## Firebase (Workload Identity Federation)

The Firebase workflow authenticates to Google Cloud with
[Workload Identity Federation](https://github.com/google-github-actions/auth#indirect-wif),
so no service-account key is stored in GitHub. One-time setup, run with an
account that is Owner on the Firebase project:

```bash
PROJECT_ID=lyf-registration            # Firebase/GCP project id
REPO=OWNER/REPO                        # GitHub repository, e.g. TACL-LYF/lyf-registration-v2
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

# 1. Deployer service account
gcloud iam service-accounts create github-deployer \
  --project="$PROJECT_ID" --display-name="GitHub Actions deployer"
SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

# 2. Roles needed by `firebase deploy --only functions,firestore`
for role in roles/firebase.admin roles/cloudfunctions.developer roles/run.admin \
            roles/iam.serviceAccountUser roles/artifactregistry.writer \
            roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$role"
done

# 3. Workload identity pool + GitHub OIDC provider, restricted to this repo
gcloud iam workload-identity-pools create github --project="$PROJECT_ID" --location=global
gcloud iam workload-identity-pools providers create-oidc github-actions \
  --project="$PROJECT_ID" --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '${REPO}'"

# 4. Let identities from that pool/repo impersonate the service account
gcloud iam service-accounts add-iam-policy-binding "$SA" --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}"

# 5. Values for the GitHub repository variables below
echo "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github-actions"
echo "GCP_SERVICE_ACCOUNT=$SA"
```

Then in the GitHub repository, **Settings → Secrets and variables → Actions**:

**Variables**

| Name                                                                | Value                                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER`                                    | printed by step 5                                                                                                     |
| `GCP_SERVICE_ACCOUNT`                                               | printed by step 5                                                                                                     |
| `FIREBASE_PROJECT_ID`                                               | Firebase/GCP project id to deploy to, e.g. `lyf-registration`                                                         |
| `GATSBY_FIRESTORE_DATABASE_ID`, `GATSBY_FIRESTORE_TEST_DATABASE_ID` | named Firestore databases (`lyf-v2`, `lyf-v2-test`); shared with the website build so both sides target the same data |
| `ALLOWED_REDIRECT_ORIGINS`                                          | comma-separated origins Stripe may redirect back to after checkout                                                    |

**Secrets** – the functions' runtime environment. The workflow writes these to
`functions/.env` before deploying, which is what the Firebase CLI applies to
the deployed functions, so it refuses to deploy if any is empty (an empty value
would overwrite the live configuration). The names match `functions/.env.example`:

- Stripe: `STRIPE_API_KEY`, `STRIPE_TEST_API_KEY`, `STRIPE_ENDPOINT_SECRET`, `STRIPE_TEST_ENDPOINT_SECRET`
- Registration email: `EMAIL`, `EMAIL_CLIENT_ID`, `EMAIL_CLIENT_SECRET`, `EMAIL_REFRESH_TOKEN`
- Firebase web config: `GATSBY_FIREBASE_API_KEY`, `GATSBY_FIREBASE_AUTH_DOMAIN`, `GATSBY_FIREBASE_PROJECT_ID`, `GATSBY_FIREBASE_STORAGE_BUCKET`, `GATSBY_FIREBASE_MESSAGING_SENDER_ID`, `GATSBY_FIREBASE_APP_ID` (and optional `GATSBY_FIREBASE_MEASUREMENT_ID`)
- Mailchimp: `MAILCHIMP_API_KEY`, `MAILCHIMP_SERVER`
- Slack: `SLACK_REGISTRATION_WEBHOOK`, `SLACK_REGISTRATION_FOR_CAMP_WEBHOOK`, `SLACK_ERROR_WEBHOOK`

The deploy jobs run in a GitHub environment named `firebase`. It is created
automatically on the first run; add required reviewers to it under
**Settings → Environments** if production deploys should need an approval, and
secrets can be scoped to it instead of the repository.
