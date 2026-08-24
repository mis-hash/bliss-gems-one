# Bliss Gems One

Static website hosted for free on **GitHub Pages** (no billing, no service account keys needed).

## Files

- `index.html` — the website (homepage)
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` — PWA support files
- `.nojekyll` — tells GitHub Pages not to run Jekyll processing on these files

## One-time setup

1. Upload all these files to the **root** of your GitHub repository (not inside any subfolder).
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment" → Source, choose **Deploy from a branch**.
4. Branch: `main`, Folder: `/ (root)`. Click **Save**.
5. Wait 1–2 minutes. Your site will be live at:
   `https://<your-github-username>.github.io/<repo-name>/`

Every time you push/update files on the `main` branch, the site updates automatically within a minute or two — no extra setup required.
