# needlegps.github.io

NeedleGPS marketing landing page. Deployed via GitHub Pages from this repo's
`main` branch. Live URL: https://needlegps.github.io

## Stack
- Vanilla HTML / CSS / JS (no build step).
- Canvas-based hero animation in `particles.js`.
- Scroll-driven Blender exploded view in `blowup.js` (frames in `renders/`).
- Smooth-scroll nav in `nav.js`.
- Client-side preview gate in `gate.js` (NOT real authentication).

## Local dev
    cd /path/to/repo
    python3 -m http.server 8765

Then open http://127.0.0.1:8765/.

## Preview gate
Soft client-side gate to keep casual visitors out. To rotate the password:

    echo -n "your-new-password" | shasum -a 256

Paste the resulting hex digest into `PASSWORD_HASH` in `gate.js`, commit + push.

For real auth, move to Cloudflare Pages with Cloudflare Access (free tier).

## License
All rights reserved. © NeedleGPS, Inc.
