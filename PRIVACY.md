# Privacy and security posture

This document describes the privacy and security posture of the NeedleGPS
marketing site as currently deployed.

## Where the site lives

- **Public URL:** `https://needlegps.com` and `https://www.needlegps.com`
- **Preview URL:** `https://needlegps.github.io` (passphrase-gated)
- **Source repository:** `github.com/needlegps/needlegps.github.io` —
  **public** at present. Everyone can read the HTML, CSS, JavaScript,
  assets, and configuration. Source files in `.gitignore` (see below)
  are kept out.
- **Custom domain DNS:** `needlegps.com` is registered through Squarespace.
  DNS records there point to GitHub Pages' anycast IPs
  (`185.199.108-111.153`). Email (MX / SPF / DKIM) routes to Google
  Workspace and is intentionally left untouched.

## Crawler / link-preview posture

- Every page sets
  `noindex,nofollow,noarchive,nocache,nosnippet,noimageindex` for every
  bot (general, Googlebot, Bingbot). A root `robots.txt` also blocks
  crawling. The site is intentionally not search-indexable.
- OpenGraph and Twitter card metadata are populated with the canonical
  NeedleGPS branding, so pasting the URL into Slack / iMessage / X
  produces a clean link preview.

## Preview passphrase gate

- `gate.js` puts a SHA-256-hashed passphrase gate in front of the
  `*.github.io` preview URL. Default passphrase: `needlegps2026`.
- The gate is **intentionally skipped** on `needlegps.com` and
  `www.needlegps.com`. The public custom domain is open to anyone with
  the URL.
- Soft gate only: a determined visitor with the URL can bypass via
  DevTools; the hash protects only against casual access and crawlers.

## Analytics

`analytics.js` is wired with the live GA4 measurement ID
**`G-PWLLG1Y8QP`** (stream `14915813152`). Configuration:

- IP address anonymization forced (`anonymize_ip: true`).
- Google advertising signals off (`allow_google_signals: false`).
- Ad personalization off (`allow_ad_personalization_signals: false`).
- Cookie-free (`client_storage: 'none'`) — no persistent identifier.
- Honors browser `Do-Not-Track` and `Global Privacy Control` signals
  (no events sent when either is enabled).
- On the public host (`needlegps.com`) analytics fire immediately on
  page view. On the preview host (`*.github.io`) analytics fire only
  after the gate is passed.

To rotate the GA4 ID: edit `NGPS_GA_ID` at the top of `analytics.js`,
commit, push. Set it back to `G-PLACEHOLDER` to disable analytics
entirely.

## What ships to the deployed site

Every file under `website/` that is NOT excluded by `.gitignore`.
Notable inclusions: `index.html`, `styles.css`, the JS bundle (`nav`,
`particles`, `blowup`, `gate`, `analytics`), the Blender frame PNGs in
`renders/`, the CT anatomy JSONs, the deck-derived JPGs, the
institutional and brand logos.

## What is excluded from the deploy (see `.gitignore`)

- `_design_system/`, `_build_ct_anatomy_real.py` — internal generators
- `_logo_options/` — A/B logo candidates for internal review only
- `beta/` — local-only mirror used during draft review
- `renders/*.blend`, `renders/build_explode.py`, `renders/run_batches.sh`,
  Blender log files, the BLENDER_NOT_FOUND fallback note — render
  pipeline source files (only the resulting PNGs ship)
- `assets/deck-renders/*.png`, `*.jpeg`, the extraction script + MANIFEST
  — deck-render extraction byproducts (only the optimised JPGs ship)
- `*.README.md` files at the asset level — internal notes
- OS / editor noise (`.DS_Store`, `.vscode/`, `.idea/`, `*.swp`)
- Local environment / secrets (`.env*`, `*.pem`, `*.key`)

## HTTPS and security headers

- TLS cert: Let's Encrypt, covers `needlegps.com` + `www.needlegps.com`,
  auto-renewing. Enforce HTTPS is ON via the Pages API.
- Strict-Transport-Security (HSTS), CSP, X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy, and Permissions-Policy are
  delivered via `<meta http-equiv>` tags in `index.html`. GitHub Pages
  doesn't let us set true HTTP response headers; meta tags are honored
  by browsers but are weaker than real headers for HSTS in particular.
- For true HTTP-header delivery the path is to front the site with
  **Cloudflare** in proxy mode (free tier). Adds `_headers`-style
  rule support plus the ability to layer Cloudflare Access for real
  per-visitor auth.

## Security audit (2026-05-21)

Four-agent audit completed. Reports in `corp docs/`:

- `SECURITY_AUDIT_source.md` — code review + secret scan. Grade **A−**.
- `SECURITY_AUDIT_dns.md` — DNS + email security. Grade **B**.
- `SECURITY_AUDIT_headers.md` — HTTP-header / TLS posture.
- `SECURITY_AUDIT_privacy_analytics.md` — GA4 + privacy validation.

**Action items (ranked):**

1. **DMARC missing** (HIGH). Recommended TXT at `_dmarc.needlegps.com`:
   `v=DMARC1; p=none; rua=mailto:cizanetti@needlegps.com; pct=100`.
   Run at `p=none` for 7 days, then escalate.
2. **CAA records missing** (MEDIUM). Lock cert issuance to Let's Encrypt
   only.
3. **HTTP security headers** delivered only via `<meta>` (MEDIUM).
   Front with Cloudflare to deliver them as true headers.
4. **MTA-STS + TLS-RPT** missing (MEDIUM). Protects inbound mail
   against TLS downgrade.
5. **Tighten SPF** `~all` → `-all` once confirmed no third-party senders
   (LOW).
6. **Remove `'unsafe-inline'`** from CSP (LOW). Refactor inline
   year-stamp + inline `style=""` attributes.

## How to rotate the preview passphrase

1. Pick a new passphrase.
2. `echo -n "your-new-passphrase" | shasum -a 256`
3. Replace `PASSWORD_HASH` at the top of `gate.js` with the new hex.
4. Update `STORAGE_VAL` (any new value) to invalidate existing sessions.
5. Commit + push. Pages rebuilds in ~60 s.

## Where this falls short

- The repo is **public**, so anyone can read the source code, copy,
  team detail, FAQ, institutional logos, JS, CT anatomy JSONs, and
  Blender frame PNGs. Investigational-device disclaimers are present in
  the footer. If the source should be private, the realistic paths are:
  (a) upgrade the `needlegps` GitHub org to Team (~$12/mo) and flip the
  repo private, (b) transfer to a personal account with GitHub Pro
  ($4/mo) — loses the `github.io` brand URL but `needlegps.com` works
  unchanged, or (c) migrate hosting to Cloudflare Pages free (supports
  private GitHub source + public deploy).
- The soft gate is JavaScript-only and not a real auth boundary.
- The Squarespace registrar interface is the source of truth for DNS
  changes; if you change records there make sure to keep the Google
  Workspace MX / SPF / DKIM records intact.
