# Bliss Gems One

Static website deployed to **Firebase Hosting** (Spark / Free plan) with automatic deploys from GitHub Actions.

## Project structure

- `public/` — your website files. `public/index.html` is the homepage.
- `firebase.json` — Firebase Hosting configuration.
- `.firebaserc` — Firebase project alias (set your real project ID here).
- `.github/workflows/firebase-hosting-merge.yml` — deploys to the **live** site on every push to `main`.
- `.github/workflows/firebase-hosting-pull-request.yml` — deploys a **preview** channel for every pull request.

## One-time setup (Firebase Spark / Free plan — no billing, no service account key)

Deploys authenticate via **Workload Identity Federation** (keyless) instead of a downloaded service account key, so it also works when an org policy blocks key creation.

1. In Google Cloud Shell (for project `bliss-gems-one`), a Workload Identity Pool (`github-pool`), OIDC provider (`github-provider`, scoped to the `mis-hash/bliss-gems-one` repo) and a `github-deployer` service account (with `roles/firebasehosting.admin`) were created — see the setup conversation for the exact `gcloud` commands.
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `GCP_WORKLOAD_IDENTITY_PROVIDER` — e.g. `projects/702608135517/locations/global/workloadIdentityPools/github-pool/providers/github-provider`
   - `GCP_SERVICE_ACCOUNT` — `github-deployer@bliss-gems-one.iam.gserviceaccount.com`
   - `FIREBASE_PROJECT_ID` — `bliss-gems-one`
3. In Firebase Console, open **Build → Hosting** and click **Get started** if Hosting isn't enabled yet.
4. Merge/push this branch into `main`. Every push to `main` deploys automatically; every pull request gets its own preview channel.
