// Scroll-driven exploded-view of the NeedleGPS device.
//
// v2 has two render paths:
//   (a) Blender PNG sequence — if /renders/manifest.json loads, preload all
//       N frames and draw the one matching the current scroll progress onto
//       the canvas, scaled to fit. This is the preferred path: the frames
//       are real 3D renders (Eevee Next, 1280x720) and look far better than
//       the particle decomposition.
//   (b) Particle decomposition fallback — same code as v1's blowup. Used
//       when the manifest is unavailable or any frame fails to preload.
//
// The sticky-pin pattern (taller-than-viewport section, sticky inner stage)
// is identical to v1. Scroll progress 0..1 drives the chosen render path.

(() => {
  const section = document.querySelector('.blowup');
  const sticky  = section && section.querySelector('.blowup-sticky');
  const canvas  = document.getElementById('blowup-canvas');
  const barFill = document.getElementById('blowup-bar-fill');
  const labelsRoot = section && section.querySelector('.blowup-labels');
  if (!section || !canvas || !sticky) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0;
  let parts = [];
  let particles = [];
  let progress = 0;
  let lastT = performance.now();

  // ---- render-sequence mode state ----
  let renderMode = 'particles';   // 'particles' | 'frames'
  let frameImgs = null;           // HTMLImageElement[]
  let frameW = 0, frameH = 0;     // intrinsic size of each frame (from manifest)
  let currentFrameIdx = -1;
  let renderRect = null;          // { dx, dy, dw, dh } — last drawn frame rect

  // Vertical placement of each device sub-component as a fraction of the
  // rendered frame's height (0 = top of frame, 1 = bottom). Each entry
  // gives the (rest, exploded) Y fractions so labels can lerp with scroll
  // progress and stay anchored to the right region of the rendered device.
  // Calibrated by visually inspecting frame_001, frame_015, frame_030.
  const FRAME_PART_Y = {
    display:  { rest: 0.22, exploded: 0.18 },   // cyan bubble-level rings (top)
    antenna:  { rest: 0.34, exploded: 0.28 },
    pcb:      { rest: 0.48, exploded: 0.42 },
    battery:  { rest: 0.54, exploded: 0.52 },
    camlock:  { rest: 0.68, exploded: 0.66 },
    shield:   { rest: 0.82, exploded: 0.84 },   // saucer-shape disposable
    needle:   { rest: 0.95, exploded: 0.96 },
  };

  async function tryLoadFrameSequence() {
    try {
      const manifestRes = await fetch('renders/manifest.json', { cache: 'force-cache' });
      if (!manifestRes.ok) {
        console.info('[blowup] manifest fetch failed, staying on particles');
        return false;
      }
      const manifest = await manifestRes.json();
      const n = manifest.frames;
      if (!Number.isFinite(n) || n < 2) return false;
      frameW = manifest.width || 1280;
      frameH = manifest.height || 720;

      // Allocate a dense array so Array.from below visits every slot.
      // (new Array(n).map skips empty slots — a subtle bug.)
      const imgs = new Array(n).fill(null);
      const loads = Array.from({ length: n }, (_, i) => new Promise((resolve) => {
        const img = new Image();
        const idx = String(i + 1).padStart(3, '0');
        img.onload  = () => { imgs[i] = img; resolve(true); };
        img.onerror = () => { console.warn('[blowup] frame failed:', idx); resolve(false); };
        img.src = `renders/frame_${idx}.png`;
      }));
      const results = await Promise.all(loads);
      const failed = results.filter((ok) => !ok).length;
      if (failed > 0) {
        console.warn(`[blowup] ${failed}/${n} frames failed, staying on particles`);
        return false;
      }
      frameImgs = imgs;
      renderMode = 'frames';
      // Keep labels visible — but `placeLabels()` now switches to the
      // FRAME_PART_Y table so each label tracks the corresponding region of
      // the rendered Blender frame instead of the canvas particle parts.
      console.info(`[blowup] Blender frame sequence loaded (${n} frames @ ${frameW}x${frameH})`);
      return true;
    } catch (e) {
      console.warn('[blowup] frame sequence load threw:', e);
      return false;
    }
  }

  const TAU = Math.PI * 2;

  function circle2D(cx, cy, r, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return out;
  }

  function rect2D(cx, cy, w, h, perEdge) {
    const out = [];
    for (let i = 0; i < perEdge; i++) {
      const t = i / (perEdge - 1);
      out.push({ x: cx - w/2 + w * t, y: cy - h/2 });
      out.push({ x: cx - w/2 + w * t, y: cy + h/2 });
      out.push({ x: cx - w/2,         y: cy - h/2 + h * t });
      out.push({ x: cx + w/2,         y: cy - h/2 + h * t });
    }
    return out;
  }

  function line2D(x1, y1, x2, y2, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      out.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    }
    return out;
  }

  // ---- part library ----
  // Each part has:
  //   id          — string key used to match HTML labels
  //   restY       — y-offset (around scene center) when assembled
  //   explodedY   — y-offset when fully exploded
  //   labelSide   — 'left' or 'right' of the part
  //   points      — local 2D points (relative to the part's own origin)
  //   color       — RGB triplet for tinting particles/lines
  //
  // The device is drawn as a 2D side-view stack so the explosion is a
  // straightforward vertical separation. Each disc is rendered as a flat
  // ellipse (thin top edge), the PCB as a small rectangle, etc.
  function buildParts(s) {
    const R = 110 * s;       // device radius
    const thin = 10 * s;     // disc height (ellipse y-radius)
    const out = [];

    // Top face / OLED display ring + small square display
    {
      const pts = [];
      pts.push(...circle2D(0, 0, R, 48));                // outer ring
      pts.push(...circle2D(0, 0, R * 0.55, 30));         // middle ring
      pts.push(...circle2D(0, 0, R * 0.22, 18));         // inner ring
      pts.push(...rect2D(0, 0, 22 * s, 22 * s, 8));      // display square
      pts.push({ x: 0, y: 0 });                          // bubble dot
      // squash y to look like a top-down disc viewed nearly edge-on
      for (const p of pts) p.y *= 0.18;
      out.push({ id: 'display', restY: -thin * 0.5, explodedY: -260 * s, labelSide: 'right', points: pts, color: [94, 234, 212] });
    }
    // Antenna / aura ring (just below display)
    {
      const pts = [];
      pts.push(...circle2D(0, 0, R * 0.98, 40));
      pts.push(...circle2D(0, 0, R * 0.88, 28));
      for (const p of pts) p.y *= 0.18;
      out.push({ id: 'antenna', restY: -thin * 0.1, explodedY: -160 * s, labelSide: 'left', points: pts, color: [165, 220, 255] });
    }
    // PCB + IMU + ESP32 wireless module
    {
      const pts = [];
      pts.push(...rect2D(0, 0, R * 1.5, 22 * s, 12));    // PCB outline
      // a few "components" on the PCB
      pts.push(...rect2D(-R * 0.45, 0, 14 * s, 10 * s, 5));
      pts.push(...rect2D( R * 0.05, 0, 18 * s, 12 * s, 6));
      pts.push(...rect2D( R * 0.55, 0,  8 * s,  8 * s, 4));
      out.push({ id: 'pcb', restY: 4 * s, explodedY: -50 * s, labelSide: 'right', points: pts, color: [200, 230, 255] });
    }
    // Battery cell
    {
      const pts = rect2D(0, 0, R * 1.2, 16 * s, 12);
      out.push({ id: 'battery', restY: 22 * s, explodedY: 50 * s, labelSide: 'left', points: pts, color: [220, 220, 230] });
    }
    // Cam-lock interface (the bottom face of the reusable device)
    {
      const pts = [];
      pts.push(...circle2D(0, 0, R, 40));
      pts.push(...circle2D(0, 0, R * 0.55, 22));
      // 4 cam-lock tabs
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        const cx = Math.cos(a) * R * 0.78;
        const cy = Math.sin(a) * R * 0.78 * 0.18; // squashed
        pts.push(...circle2D(cx, cy, 6 * s, 8));
      }
      for (const p of pts) if (Math.abs(p.y) > 0.05) p.y *= 0.18;
      out.push({ id: 'camlock', restY: 38 * s, explodedY: 130 * s, labelSide: 'right', points: pts, color: [180, 220, 230] });
    }
    // Sterile shield (the disposable that snaps onto the bottom)
    {
      const pts = [];
      pts.push(...circle2D(0, 0, R * 1.05, 44));
      pts.push(...circle2D(0, 0, R * 0.85, 32));
      // central hole for needle
      pts.push(...circle2D(0, 0, R * 0.18, 18));
      for (const p of pts) p.y *= 0.18;
      out.push({ id: 'shield', restY: 56 * s, explodedY: 220 * s, labelSide: 'left', points: pts, color: [255, 255, 255] });
    }
    // Needle (a long vertical line + tip)
    {
      const pts = [];
      pts.push(...line2D(0, 0, 0, 220 * s, 26));
      // small bevel at the tip
      pts.push({ x: -2 * s, y: 220 * s });
      pts.push({ x:  2 * s, y: 220 * s });
      out.push({ id: 'needle', restY: 60 * s, explodedY: 300 * s, labelSide: 'right', points: pts, color: [180, 200, 255] });
    }
    return out;
  }

  function buildScene() {
    const s = Math.min(W / 1300, H / 900);
    parts = buildParts(Math.max(0.55, s));

    // Flatten all part points into a particle list, remembering the part
    // index so we can offset by the current part offset each frame.
    const total = parts.reduce((acc, p) => acc + p.points.length, 0);
    if (particles.length !== total) {
      particles = new Array(total);
      let i = 0;
      for (let pi = 0; pi < parts.length; pi++) {
        const part = parts[pi];
        for (const lp of part.points) {
          particles[i] = {
            partIndex: pi,
            lx: lp.x, ly: lp.y,
            x: W * (0.4 + 0.2 * Math.random()),
            y: H * (0.4 + 0.2 * Math.random()),
            vx: 0, vy: 0,
            phase: Math.random() * TAU,
            freq: 0.3 + Math.random() * 0.6,
          };
          i++;
        }
      }
    } else {
      // resize: update local point coords (in case scale changed)
      let i = 0;
      for (const part of parts) {
        for (const lp of part.points) {
          particles[i].lx = lp.x;
          particles[i].ly = lp.y;
          particles[i].partIndex = parts.indexOf(part);
          i++;
        }
      }
    }
  }

  function resize() {
    W = canvas.clientWidth = canvas.offsetWidth;
    H = canvas.clientHeight = canvas.offsetHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildScene();
    placeLabels(progress);
  }

  // ---- scroll progress ----
  function computeProgress() {
    const rect = section.getBoundingClientRect();
    const sectionTop = rect.top + window.scrollY;
    const sectionH = section.offsetHeight;
    const viewportH = window.innerHeight;
    const totalScrollable = Math.max(1, sectionH - viewportH);
    const scrolledInto = window.scrollY - sectionTop;
    const t = scrolledInto / totalScrollable;
    return Math.max(0, Math.min(1, t));
  }

  function onScroll() {
    progress = computeProgress();
    if (barFill) barFill.style.width = (progress * 100).toFixed(1) + '%';
    placeLabels(progress);
  }

  // ---- label placement ----
  function placeLabels(prog) {
    if (!labelsRoot) return;
    const labels = labelsRoot.querySelectorAll('.b-label');
    const eased = easeOut(prog);
    // fade in across mid-scroll for both modes
    const fade = clamp((prog - 0.15) / 0.5, 0, 1);

    if (renderMode === 'frames' && renderRect) {
      // Position labels along the vertical span of the actual rendered
      // Blender frame. Horizontal: just outside the image left/right.
      const { dx, dy, dw, dh } = renderRect;
      const leftX  = dx - 28;             // labels with side="left" anchor here
      const rightX = dx + dw + 28;        // labels with side="right" anchor here
      labels.forEach((el) => {
        const id = el.dataset.part;
        const tbl = FRAME_PART_Y[id];
        if (!tbl) { el.style.opacity = 0; return; }
        const yFrac = tbl.rest + (tbl.exploded - tbl.rest) * eased;
        const isRight = el.classList.contains('right');
        el.style.left = (isRight ? rightX : leftX) + 'px';
        el.style.top  = (dy + yFrac * dh) + 'px';
        el.style.opacity = fade.toFixed(2);
      });
      return;
    }

    // particle-mode (fallback) — anchor to the canvas-center part offsets
    const cx = W / 2;
    const cy = H / 2;
    labels.forEach((el) => {
      const id = el.dataset.part;
      const part = parts.find((p) => p.id === id);
      if (!part) { el.style.opacity = 0; return; }
      const y = part.restY + (part.explodedY - part.restY) * eased;
      const x = part.labelSide === 'right' ? cx + 160 : cx - 160;
      el.style.left = x + 'px';
      el.style.top  = (cy + y) + 'px';
      el.style.opacity = fade.toFixed(2);
    });
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 2.2); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---- animation ----
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (renderMode === 'frames') {
      // Frame-sequence mode: nothing to simulate; just draw the current
      // PNG. We still loop on RAF (cheaply) so a resize redraws correctly.
      drawFrames();
      if (!reduceMotion) requestAnimationFrame(frame);
      return;
    }

    // particle-decomposition fallback
    const cx = W / 2;
    const cy = H / 2;
    const pe = easeOut(progress);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const part = parts[p.partIndex];
      const offY = part.restY + (part.explodedY - part.restY) * pe;
      p.tx = cx + p.lx;
      p.ty = cy + p.ly + offY;
    }
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const ks = 7.0, damp = 0.84;
      const dx = p.tx - p.x, dy = p.ty - p.y;
      p.vx = (p.vx + dx * ks * dt) * damp;
      p.vy = (p.vy + dy * ks * dt) * damp;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      if (!reduceMotion) {
        const tt = now * 0.001 * p.freq;
        p.x += Math.sin(tt + p.phase) * 0.06;
        p.y += Math.cos(tt * 0.8 + p.phase) * 0.06;
      }
    }

    draw();
    if (!reduceMotion) requestAnimationFrame(frame);
  }

  function drawFrames() {
    // Pick the frame matching scroll progress and draw it into a zone that
    // sits clear of the head (top 26%) and the progress bar (bottom 10%).
    // Letterbox-fit, centered horizontally. We also stash the drawn rect on
    // `renderRect` so label placement can anchor to the rendered image.
    if (!frameImgs) return;
    const n = frameImgs.length;
    const idx = Math.max(0, Math.min(n - 1, Math.round(easeOut(progress) * (n - 1))));
    const img = frameImgs[idx];
    if (!img) return;

    ctx.clearRect(0, 0, W, H);
    // Render zone — deliberately pushed further down (was 0.26) so the
    // head + subhead has room to breathe above the device. Bottom edge
    // sits above the progress bar.
    const zoneTop    = H * 0.36;
    const zoneBottom = H * 0.90;
    const zoneH      = zoneBottom - zoneTop;
    const zoneW      = W * 0.70;
    const scale = Math.min(zoneW / frameW, zoneH / frameH);
    const dw = frameW * scale, dh = frameH * scale;
    const dx = (W - dw) / 2;
    const dy = zoneTop + (zoneH - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    renderRect = { dx, dy, dw, dh };
    currentFrameIdx = idx;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // connection lines within each part
    const r = 40, r2 = r * r;
    ctx.lineWidth = 1;
    // bucket particles by part for fast within-part neighbour test
    const byPart = parts.map(() => []);
    for (const p of particles) byPart[p.partIndex].push(p);
    for (let pi = 0; pi < byPart.length; pi++) {
      const arr = byPart[pi];
      const [cr, cg, cb] = parts[pi].color;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2) {
            const alpha = (1 - d2 / r2) * 0.30;
            ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }

    // particles
    for (const p of particles) {
      const part = parts[p.partIndex];
      const [cr, cg, cb] = part.color;
      ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.88)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, TAU);
      ctx.fill();
    }
  }

  // ---- boot ----
  window.addEventListener('resize', () => {
    cancelAnimationFrame(window.__bzRz);
    window.__bzRz = requestAnimationFrame(resize);
  });
  window.addEventListener('scroll', onScroll, { passive: true });

  resize();
  onScroll();

  // Attempt to upgrade to the Blender frame-sequence renderer. Done async so
  // the particle fallback is already running and the user sees something on
  // first paint regardless. The swap is invisible — first drawFrames() call
  // overwrites the particle frame on the same canvas.
  tryLoadFrameSequence();

  if (reduceMotion) {
    progress = 0.6;
    onScroll();
    if (renderMode === 'frames') {
      drawFrames();
    } else {
      for (const p of particles) {
        const part = parts[p.partIndex];
        const offY = part.restY + (part.explodedY - part.restY) * 0.6;
        p.x = W / 2 + p.lx;
        p.y = H / 2 + p.ly + offY;
      }
      draw();
    }
  } else {
    requestAnimationFrame(frame);
  }
})();
