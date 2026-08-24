# Bliss Gems One

Static website deployed to **Firebase Hosting** (Spark / Free plan) with automatic deploys from GitHub Actions.

## Project structure

- `public/` — your website files. `public/index.html` is the homepage.
- `firebase.json` — Firebase Hosting configuration.
- `.firebaserc` — Firebase project alias (set your real project ID here).
- `.github/workflows/firebase-hosting-merge.yml` — deploys to the **live** site on every push to `main`.
- `.github/workflows/firebase-hosting-pull-request.yml` — deploys a **preview** channel for every pull request.

## One-time setup (Firebase Spark / Free plan — no billing needed)

1. Go to https://console.firebase.google.com and create a project (or use an existing one). Do **not** upgrade to Blaze — Hosting works on the free Spark plan.
2. In the project, open **Build → Hosting** and click **Get started** (you can skip the CLI steps shown there).
3. Open **Project settings → Service accounts → Generate new private key**. This downloads a JSON file — keep it safe, it is a credential.
4. In your GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `FIREBASE_SERVICE_ACCOUNT` — paste the **entire contents** of the JSON file from step 3.
   - `FIREBASE_PROJECT_ID` — your Firebase project ID (found in Project settings → General).
5. Replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` in `.firebaserc` with the same project ID (optional, only needed for local `firebase deploy`).
6. Merge/push this branch into `main`. Every push to `main` will deploy automatically; every pull request gets its own preview URL.
