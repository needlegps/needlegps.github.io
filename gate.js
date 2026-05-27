// Client-side password gate for the GitHub Pages deploy.
//
// IMPORTANT: this is a SOFT gate, not real authentication. GitHub Pages
// serves static content with no server-side auth. Anyone who knows the
// password (or can brute-force a weak password) can pass it. The hash
// of the password is hardcoded in this file, so anyone who views source
// can attempt offline cracking. Use a long, throwaway shared password
// (rotate weekly) and treat the site as semi-public. For real auth, move
// to Cloudflare Pages + Cloudflare Access (free tier).
//
// Rotating the password:
//   1) Pick a new password.
//   2) Compute its SHA-256:  echo -n "yourpassword" | shasum -a 256
//   3) Replace PASSWORD_HASH below with the new hex digest.
//   4) Commit + push. Old visitors will need to re-enter.

(() => {
  const PASSWORD_HASH = '7988f22558f8c26132041757e994ace3b948cd8a469d08476aecccfc8924aece';
  const STORAGE_KEY = 'ngps-gate-passed';
  const STORAGE_VAL = '20260519-i';

  // The gate is intentionally only active on the github.io preview URL.
  // On the public custom domain (needlegps.com / www.needlegps.com) the
  // site is meant to be open and we skip the gate entirely.
  const host = location.hostname.toLowerCase();
  const PUBLIC_HOSTS = ['needlegps.com', 'www.needlegps.com'];
  if (PUBLIC_HOSTS.includes(host)) return;

  // already unlocked in this browser?
  if (sessionStorage.getItem(STORAGE_KEY) === STORAGE_VAL) return;

  // Build the gate overlay before the body content paints. The script is
  // loaded at end of <body> with defer, so the page has rendered briefly;
  // we hide the rest with an opaque overlay until the password matches.
  const overlay = document.createElement('div');
  overlay.id = 'ngps-gate';
  overlay.innerHTML = `
    <div class="ngps-gate-card">
      <div class="ngps-gate-mark"></div>
      <div class="ngps-gate-eyebrow">PREVIEW · INVITE ONLY</div>
      <h1>NeedleGPS</h1>
      <p>Enter the preview passphrase to continue.</p>
      <form id="ngps-gate-form" autocomplete="off">
        <input type="password" id="ngps-gate-input"
               autocomplete="off" autocapitalize="off" spellcheck="false"
               placeholder="passphrase" />
        <button type="submit">Enter</button>
      </form>
      <div id="ngps-gate-err" aria-live="polite"></div>
      <div class="ngps-gate-foot">Investigational device.</div>
    </div>
  `;
  document.documentElement.appendChild(overlay);
  document.documentElement.classList.add('ngps-gate-locked');

  async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const dig = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(dig))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const form = document.getElementById('ngps-gate-form');
  const input = document.getElementById('ngps-gate-input');
  const err = document.getElementById('ngps-gate-err');
  input.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const v = input.value.trim();
    if (!v) return;
    const h = await sha256Hex(v);
    if (h === PASSWORD_HASH) {
      sessionStorage.setItem(STORAGE_KEY, STORAGE_VAL);
      overlay.remove();
      document.documentElement.classList.remove('ngps-gate-locked');
    } else {
      err.textContent = 'Incorrect.';
      input.value = '';
      input.focus();
    }
  });
})();
