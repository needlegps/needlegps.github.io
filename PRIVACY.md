# Privacy posture

This site is an **invite-only preview** of NeedleGPS marketing material.
The intent is that no information about the company, team, device, or
roadmap is discoverable through the open web until we choose to publish.

## What is private

- **Source repository** — `github.com/needlegps/needlegps.github.io` is a
  private repo on the NeedleGPS org. Only org members can read the code,
  assets, copy, and configuration.
- **Search-engine indexing** — every page sets
  `noindex,nofollow,noarchive,nocache,nosnippet,noimageindex` for every
  bot, plus a root `robots.txt` blocks crawling.
- **Link-preview cards** — OpenGraph and Twitter card metadata are set to
  generic "Private preview" / "Access by invitation only" strings so
  pasting the URL into Slack, X, iMessage, etc. doesn't leak imagery,
  device detail, or team names.
- **Visitor gate** — `gate.js` requires a passphrase before any content
  paints (`html.ngps-gate-locked { overflow: hidden }` keeps the body
  hidden until unlock). This is a SOFT gate — a determined visitor with
  the URL can bypass it via DevTools — but it stops casual access and
  search engines.

## What is shipped to the deployed site

Every file under `website/` that is NOT excluded by `.gitignore`. Notable
inclusions: `index.html`, `styles.css`, the JS bundle (`nav`, `particles`,
`blowup`, `gate`, `analytics`), the Blender frame PNGs in `renders/`, the
CT anatomy JSONs, the deck-derived JPGs, the institutional logos, the
brand mark PNG.

## What is excluded from the deploy (see `.gitignore`)

- `_design_system/`, `_build_ct_anatomy_real.py` — internal generators
- `beta/` — local-only mirror used during draft review
- `renders/*.blend`, `renders/build_explode.py`, `renders/run_batches.sh`,
  Blender log files, the BLENDER_NOT_FOUND fallback note — the render
  pipeline source files are not part of the public deploy
- `assets/deck-renders/*.png`, `*.jpeg`, the extraction script + MANIFEST
  — the deck-render extraction byproducts; only the optimised JPGs ship
- `*.README.md` files at the asset level — internal notes
- OS / editor noise (`.DS_Store`, `.vscode/`, `.idea/`, `*.swp`)
- Local environment / secrets (`.env*`, `*.pem`, `*.key`)

## Analytics

`analytics.js` is configured for **privacy-preserving Google Analytics 4**:

- IP address anonymization is forced (`anonymize_ip: true`).
- All Google advertising signals are off (`allow_google_signals: false`,
  `allow_ad_personalization_signals: false`).
- Cookie-free configuration (`client_storage: 'none'`) — viewers are not
  given persistent identifiers.
- Honors browser `Do-Not-Track` and `Global Privacy Control` signals.
- Does NOT fire until the preview gate has been unlocked
  (sessionStorage key `ngps-gate-passed`).

To activate, replace `G-PLACEHOLDER` at the top of `analytics.js` with a
real GA4 measurement ID and re-deploy.

## How to rotate the preview passphrase

1. Pick a new passphrase.
2. `echo -n "your-new-passphrase" | shasum -a 256`
3. Replace `PASSWORD_HASH` at the top of `gate.js` with the new hex.
4. Commit + push. The next session-storage write key
   (`STORAGE_VAL`) doubles as a cache buster.

## Where this falls short

GitHub Pages cannot enforce real authentication. The site source is
private (we deploy from a private repo), but the deployed HTML / JS / SVG
/ PNG / JSON assets are still served by GitHub's CDN to anyone who has
the URL. The gate is a JavaScript-only soft block.

For real per-visitor auth (magic-link email, SSO, etc.), move the
deployment to **Cloudflare Pages + Cloudflare Access** (free tier) or
**Vercel + Vercel Authentication**. Both support deploying from a private
GitHub repo and add a true authentication layer in front of the static
files.
