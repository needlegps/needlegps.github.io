# needlegps.github.io

NeedleGPS marketing landing page. Static site served via GitHub Pages from
the `main` branch.

- **Public URL:** https://needlegps.com (and https://www.needlegps.com)
- **Preview URL:** https://needlegps.github.io (gated)

## Stack

- Vanilla HTML / CSS / JS (no build step).
- Canvas-based hero animation in `particles.js` (rotating 3D device,
  cycling axial CT slices, ambient flow-field background).
- Scroll-driven Blender exploded-view in `blowup.js`, frames in `renders/`.
- Smooth-scroll nav in `nav.js`.
- Client-side preview gate in `gate.js` (soft block; not real auth).
- Privacy-aware GA4 analytics in `analytics.js`.

## Hosting

Custom domain configured at Squarespace DNS (A records for the apex point
to GitHub Pages' anycast IPs `185.199.108-111.153`; `www` CNAMEs to
`needlegps.github.io`). HTTPS via auto-renewing Let's Encrypt (Pages-issued,
covers apex + www, ~90-day rotation). Email (MX / SPF / DKIM) is on
Google Workspace and intentionally untouched.

## Local dev

```
cd /path/to/repo
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/.

## Preview gate

`gate.js` enforces a SHA-256-hashed passphrase on the github.io preview
URL only. The custom domain (`needlegps.com` / `www.needlegps.com`)
intentionally bypasses the gate. Default passphrase: `needlegps2026`.

To rotate:

```
echo -n "your-new-passphrase" | shasum -a 256
```

Paste the resulting hex into `PASSWORD_HASH` in `gate.js`. Bump
`STORAGE_VAL` (any new value) to invalidate existing sessions. Commit +
push; Pages rebuilds in ~60 s.

For real per-visitor auth (magic-link, SSO, etc.) the path is to front
the site with Cloudflare Pages + Cloudflare Access (free tier).

## Analytics

GA4 measurement ID `G-PWLLG1Y8QP` (stream `14915813152`). Configured for
privacy: IP anonymized, no advertising signals, cookie-free, honors DNT
and Global Privacy Control. See `PRIVACY.md` for full posture.

To disable: set `NGPS_GA_ID` back to `G-PLACEHOLDER` in `analytics.js`.

## Repo visibility

This repo is **public**. The full source — HTML, CSS, JS bundle, brand
assets, Blender frame PNGs, CT anatomy JSONs, institutional logos —
is visible to anyone who finds the repo URL. `.gitignore` excludes
internal-only artifacts (`_design_system/`, `_logo_options/`, `beta/`,
render-pipeline source files, deck-render extraction byproducts,
`*.README.md` notes, OS noise, secrets patterns).

If the source should be private, see `PRIVACY.md` § "Where this falls
short" for the three viable paths (org Team plan, personal Pro transfer,
or Cloudflare Pages migration).

## Security

Comprehensive security audit completed 2026-05-21. Reports in
`corp docs/SECURITY_AUDIT_*.md` (source review, DNS, HTTP headers, GA4
+ privacy). Open action items tracked in `PRIVACY.md` § "Security
audit." Top priorities: add DMARC + CAA records, refresh stale docs
(done), front with Cloudflare for real HTTP security headers.

## License

All rights reserved. © NeedleGPS, Inc.

Investigational device. Limited by United States law to investigational
use. Not for sale.
