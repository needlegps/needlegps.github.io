// NeedleGPS hero animation v2.
// Two scenes in one canvas:
//   - Right half: a 3D NeedleGPS device whose particles rotate around the
//     vertical axis (yaw), with a needle drawn at the bottom and a green
//     "bubble level" dot floating on the top face.
//   - Left half: an axial CT chest section that cycles through 4 canonical
//     slice silhouettes (apex / aortic arch / 4-chamber heart / diaphragm).
// Particles drift gently around their target positions and are connected by
// thin lines when nearby (limited to same-layer neighbours).
//
// All target-position math runs in scene-local coordinates and is translated
// to canvas coordinates at draw time. Resizing rebuilds the targets without
// reallocating particle objects so the swarm stays continuous.

(() => {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0;
  let scene = null;
  let particles = [];
  let ambient = [];   // background atmosphere — drifts via flow field only, no targets

  // ---- live angle HUD ----
  const hudTheta = document.getElementById('hud-theta');
  const hudPsi   = document.getElementById('hud-psi');
  const RAD_TO_DEG = 180 / Math.PI;
  // Throttle DOM writes: only update when the tenth-of-a-degree value
  // (cast to a small integer for stable comparison) changes.
  function updateHud(el, key, radians) {
    const deg = radians * RAD_TO_DEG;
    const code = Math.round(deg * 10);   // 0.1° resolution
    if (el[key] === code) return;
    el[key] = code;
    const sign = deg >= 0 ? '+' : '−';
    const abs = Math.abs(deg);
    const whole = String(Math.floor(abs)).padStart(2, '0');
    const tenth = String(Math.floor((abs - Math.floor(abs)) * 10));
    el.textContent = `${sign}${whole}.${tenth}°`;
  }

  // ---- helpers ----
  const TAU = Math.PI * 2;

  function ellipse2D(cx, cy, rx, ry, n, rot = 0, t0 = 0, t1 = TAU) {
    const out = [];
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const t = t0 + (t1 - t0) * (i / n);
      const x = Math.cos(t) * rx, y = Math.sin(t) * ry;
      out.push({ x: cx + x * c - y * s, y: cy + x * s + y * c });
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

  function bezier2D(p0, p1, p2, p3, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), m = 1 - t;
      out.push({
        x: m * m * m * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * p3.x,
        y: m * m * m * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * p3.y,
      });
    }
    return out;
  }

  // ---- 3D device geometry ----
  // The device is a hockey-puck: a top circle, a bottom circle, vertical edge
  // lines (cylinder side), two grip-band circles slightly below the top, a
  // bubble-level concentric inner ring on the top face, a side button on the
  // +x side, and a vertical needle below.
  //
  // Coordinate system (right-handed): +x right, +y up, +z towards viewer.
  // Top face at y = +h/2, bottom face at y = -h/2. The needle extends from
  // y = -h/2 down to y = -h/2 - needleLen.
  function buildDevice3D(s) {
    const R = 64 * s;
    const h = 30 * s;
    const needleLen = 240 * s;
    const verts = [];

    function pushCircleXZ(yPlane, r, n) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        verts.push({ x: r * Math.cos(a), y: yPlane, z: r * Math.sin(a), layer: 'device' });
      }
    }

    pushCircleXZ(+h / 2, R, 56);          // top face edge
    pushCircleXZ(-h / 2, R, 40);          // bottom face edge
    pushCircleXZ(+h / 2 - 6 * s, R * 0.95, 28); // grip band 1
    pushCircleXZ(+h / 2 - 12 * s, R * 0.95, 28); // grip band 2

    // top face concentric "bubble level" rings (mid + inner)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      verts.push({ x: 0.58 * R * Math.cos(a), y: +h / 2 + 0.01, z: 0.58 * R * Math.sin(a), layer: 'device' });
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      verts.push({ x: 0.22 * R * Math.cos(a), y: +h / 2 + 0.01, z: 0.22 * R * Math.sin(a), layer: 'device' });
    }
    // center dot on top face (the "you're on target" indicator)
    verts.push({ x: 0, y: +h / 2 + 0.01, z: 0, layer: 'device-dot' });

    // vertical edge lines (8 spokes from top to bottom)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const px = R * Math.cos(a), pz = R * Math.sin(a);
      for (let k = 0; k < 5; k++) {
        const t = k / 4;
        verts.push({ x: px, y: +h / 2 + (-h) * t, z: pz, layer: 'device' });
      }
    }

    // side button (small cluster at +x side)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      verts.push({ x: R + 1.5 * s, y: 0 + Math.cos(a) * 3 * s, z: 0 + Math.sin(a) * 3 * s, layer: 'device' });
    }

    // needle: vertical line below bottom face
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      verts.push({ x: 0, y: -h / 2 - needleLen * t, z: 0, layer: 'device-needle' });
    }

    return { verts, R, h, needleLen };
  }

  // ---- CT chest slice silhouettes ----
  // We have two sources of slice data:
  //   1) `ctAnatomy` (loaded async from `ct_anatomy.json`): 8 axial slices,
  //      16 shapes each, with vessel-edge metadata. Higher-resolution and
  //      anatomically richer.
  //   2) hardcoded fallback in `sliceShapes(r, kind)`: 4 coarse slices.
  // SLICE_N is the number of points per slice and stays constant either way
  // so we don't have to reallocate particles on upgrade.
  // Higher density so the chest reads as an actual axial slice rather than a
  // sparse constellation. With 16 shapes per slice and SLICE_N = 520, big
  // structures (body wall, lungs) get ~50-90 points each while small vessels
  // get ~8-15 — point count scales with shape perimeter.
  const SLICE_N = 520;
  let ctAnatomy = null;

  // role → particle color tint (rgba pieces). Used in draw() to vary
  // chest-particle colour by anatomical tissue type so the slice reads as
  // anatomy rather than a uniform cloud.
  const ROLE_COLOR = {
    bone:   [245, 250, 255],
    vessel: [94, 234, 212],
    lung:   [130, 165, 215],
    air:    [110, 145, 195],
    soft:   [199, 210, 254],
    lesion: [255, 174, 122],
    fat:    [255, 230, 200],
    null:   [199, 210, 254],
  };

  // Sample a JSON-defined shape into N evenly-spaced perimeter points.
  function sampleJsonShape(shape, n) {
    const out = [];
    const cx = shape.x, cy = shape.y, r = shape.r;
    const kind = shape.shape;
    for (let i = 0; i < n; i++) {
      let a, px, py;
      if (kind === 'crescent' || kind === 'arc') {
        // ~180° upper arc — used for the aortic arch / azygos arch sweep
        a = -Math.PI / 2 + Math.PI * (i / Math.max(1, n - 1));
        px = cx + Math.cos(a) * r;
        py = cy + Math.sin(a) * r * 0.6;
      } else if (kind === 'kidney') {
        // ellipse with one side indented (the lung-against-mediastinum side)
        a = (i / n) * TAU;
        const indent = Math.cos(a) > 0 ? 0.68 : 1.0;
        px = cx + Math.cos(a) * r * indent;
        py = cy + Math.sin(a) * r * 0.85;
      } else {
        // ellipse (default)
        a = (i / n) * TAU;
        px = cx + Math.cos(a) * r;
        py = cy + Math.sin(a) * r;
      }
      out.push({ x: px, y: py });
    }
    return out;
  }

  // ---- polyline resampling for real-anatomy contours ----
  // Resample an arbitrary polyline `points` (array of [x, y]) into exactly
  // `n` evenly-arc-length-spaced points. Used when we load real CT-derived
  // contours from `ct_anatomy_real.json`.
  function resamplePolyline(points, n) {
    if (!points || points.length === 0) {
      const out = []; for (let i = 0; i < n; i++) out.push({ x: 0, y: 0 }); return out;
    }
    if (points.length === 1) {
      const [x, y] = points[0];
      const out = []; for (let i = 0; i < n; i++) out.push({ x, y }); return out;
    }
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i][0] - points[i - 1][0];
      const dy = points[i][1] - points[i - 1][1];
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const total = cum[cum.length - 1];
    if (total === 0) {
      const [x, y] = points[0];
      const out = []; for (let i = 0; i < n; i++) out.push({ x, y }); return out;
    }
    const out = [];
    let seg = 0;
    for (let i = 0; i < n; i++) {
      const t = (i / Math.max(1, n - 1)) * total;
      while (seg < cum.length - 2 && cum[seg + 1] < t) seg++;
      const span = cum[seg + 1] - cum[seg] || 1;
      const u = (t - cum[seg]) / span;
      const a = points[seg], b = points[seg + 1];
      out.push({ x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u });
    }
    return out;
  }

  // Fixed per-role point budget so the i-th particle is always the same
  // anatomical role across every slice. Particles morph short distances
  // (body→body, lung→lung, etc.) instead of crossing the slice to a totally
  // different structure. Sum must equal SLICE_N.
  const ROLE_BUDGETS = [
    ['body',   200],
    ['lung',   100],
    ['heart',   80],
    ['spine',   50],
    ['bone',    30],
    ['vessel',  30],
    ['fat',     20],
    ['soft',    10],
  ];
  // total = 520 = SLICE_N

  function _bodyCentroid(byRole) {
    const pool = (byRole.body || []).flat();
    if (!pool.length) return [0, 0];
    let sx = 0, sy = 0;
    for (const [x, y] of pool) { sx += x; sy += y; }
    return [sx / pool.length, sy / pool.length];
  }

  // Build a SLICE_N point cloud where indices are role-grouped. Particles
  // never change role across slices, so morphing keeps each particle inside
  // its anatomical structure.
  function buildSliceByRole(sliceData) {
    const contours = sliceData.contours || [];
    const byRole = {};
    for (const c of contours) {
      const role = c.role || 'soft';
      (byRole[role] = byRole[role] || []).push(c.points || []);
    }
    const [cx, cy] = _bodyCentroid(byRole);
    const pts = [];
    for (const [role, budget] of ROLE_BUDGETS) {
      const pool = byRole[role] || [];
      if (pool.length === 0) {
        // Role missing in this slice: ghost particles collapse to body
        // centroid so the morph "absorbs" them rather than launching them
        // across the slice. They still get rendered (role-tinted) but read
        // as faint dust near body center.
        for (let i = 0; i < budget; i++) pts.push({ x: cx, y: cy, role });
        continue;
      }
      // Concatenate all polylines for this role into one and resample to
      // budget points along arc length.
      const flat = [];
      for (const p of pool) for (const xy of p) flat.push(xy);
      const sampled = resamplePolyline(flat, budget);
      for (const p of sampled) pts.push({ x: p.x, y: p.y, role });
    }
    while (pts.length < SLICE_N) pts.push({ x: 0, y: 0, role: 'soft' });
    pts.length = SLICE_N;
    return pts;
  }

  // Build a SLICE_N point cloud from a real-anatomy slice (contours schema).
  // Each contour gets a point budget proportional to its polyline length so
  // long body-wall contours stay dense while small vessels get fewer points.
  function buildSliceFromContours(sliceData) {
    const contours = sliceData.contours || [];
    if (contours.length === 0) {
      const out = []; for (let i = 0; i < SLICE_N; i++) out.push({ x: 0, y: 0, role: 'soft' }); return out;
    }
    const lengths = contours.map((c) => {
      let L = 0;
      const pts = c.points || [];
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0];
        const dy = pts[i][1] - pts[i - 1][1];
        L += Math.sqrt(dx * dx + dy * dy);
      }
      return Math.max(0.001, L);
    });
    const totalLen = lengths.reduce((a, b) => a + b, 0);
    const alloc = lengths.map((L) => Math.max(4, Math.round(SLICE_N * L / totalLen)));
    let sum = alloc.reduce((a, b) => a + b, 0);
    let k = 0;
    while (sum > SLICE_N) {
      if (alloc[k] > 4) { alloc[k]--; sum--; }
      k = (k + 1) % alloc.length;
    }
    k = 0;
    while (sum < SLICE_N) { alloc[k]++; sum++; k = (k + 1) % alloc.length; }
    const pts = [];
    for (let c = 0; c < contours.length; c++) {
      const role = contours[c].role || 'soft';
      const resampled = resamplePolyline(contours[c].points, alloc[c]);
      for (const p of resampled) pts.push({ x: p.x, y: p.y, role });
    }
    while (pts.length < SLICE_N) pts.push({ x: 0, y: 0, role: 'soft' });
    pts.length = SLICE_N;
    return pts;
  }

  // Convert a JSON slice into SLICE_N canvas-relative points with each point
  // also carrying the fill_role of its source shape (used for colour).
  // Points-per-shape is allocated PROPORTIONAL TO PERIMETER so the body
  // outline gets dense sampling while small vessels stay distinct.
  function buildSliceFromJson(sliceData) {
    const shapes = sliceData.shapes;
    const perims = shapes.map((s) => Math.max(0.02, s.r));
    const totalP = perims.reduce((a, b) => a + b, 0);
    const alloc  = perims.map((p) => Math.max(5, Math.round(SLICE_N * p / totalP)));
    let sum = alloc.reduce((a, b) => a + b, 0);
    let k = 0;
    // adjust allocations so the total exactly equals SLICE_N
    while (sum > SLICE_N) {
      if (alloc[k] > 5) { alloc[k]--; sum--; }
      k = (k + 1) % alloc.length;
    }
    k = 0;
    while (sum < SLICE_N) { alloc[k]++; sum++; k = (k + 1) % alloc.length; }
    const pts = [];
    for (let s = 0; s < shapes.length; s++) {
      const shapePts = sampleJsonShape(shapes[s], alloc[s]);
      const role = shapes[s].fill_role || 'soft';
      for (const p of shapePts) pts.push({ x: p.x, y: p.y, role });
    }
    while (pts.length < SLICE_N) pts.push({ x: 0, y: 0, role: 'soft' });
    pts.length = SLICE_N;
    return pts;
  }

  // Dispatch slice builder based on schema. Real polyline contours get
  // the role-budgeted build so each particle index is anatomically stable
  // across slices and morphs short distances.
  function buildSliceAny(sliceData) {
    if (Array.isArray(sliceData.contours)) return buildSliceByRole(sliceData);
    if (Array.isArray(sliceData.shapes))   return buildSliceFromJson(sliceData);
    return [];
  }

  // Compute role centroids for vessel-edge drawing. Edges in the real JSON
  // reference role names (e.g. ["body", "spine"]); the synthetic JSON
  // references shape names. We handle both by returning a map of name → {x,y}
  // suitable for the edge drawing loop in draw().
  function computeSliceCenters(sliceData, chestCx, chestCy, chestR) {
    const m = {};
    if (Array.isArray(sliceData.contours)) {
      // Real anatomy: centroid per role across all that role's contours.
      const acc = {};
      for (const c of sliceData.contours) {
        const role = c.role || 'soft';
        if (!acc[role]) acc[role] = { sx: 0, sy: 0, n: 0 };
        for (const [px, py] of c.points) {
          acc[role].sx += px; acc[role].sy += py; acc[role].n++;
        }
      }
      for (const role in acc) {
        const a = acc[role];
        m[role] = { x: chestCx + (a.sx / a.n) * chestR,
                    y: chestCy + (a.sy / a.n) * chestR };
      }
    } else if (Array.isArray(sliceData.shapes)) {
      // Synthetic: each shape has an explicit (x, y) centre and a name.
      for (const sh of sliceData.shapes) {
        m[sh.name] = { x: chestCx + sh.x * chestR, y: chestCy + sh.y * chestR };
      }
    }
    return m;
  }

  // Async-load richer anatomy. Tries the real-CT-derived file first, falls
  // back to the synthetic schema, then to hardcoded shapes. On success, swaps
  // the loaded data into the running scene in place (no particle realloc).
  async function loadCtAnatomy() {
    const tried = [];
    async function tryUrl(url) {
      tried.push(url);
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !Array.isArray(data.axial) || data.axial.length < 2) return null;
      return data;
    }
    let data = null, source = '';
    try {
      data = await tryUrl('ct_anatomy_real.json');
      if (data) source = 'real (NIfTI-derived)';
    } catch (_) { /* try fallback */ }
    if (!data) {
      try {
        data = await tryUrl('ct_anatomy.json');
        if (data) source = 'synthetic (schematic)';
      } catch (_) { /* fall through to hardcoded */ }
    }
    if (!data) {
      console.warn('[hero] no CT anatomy JSON loaded; using hardcoded fallback. tried:', tried);
      return;
    }
    ctAnatomy = data;
    if (scene) {
      scene.slices = ctAnatomy.axial.map((s) => {
        const norm = buildSliceAny(s);
        return norm.map((p) => ({ x: p.x * scene.chestR, y: p.y * scene.chestR, role: p.role }));
      });
      scene.sliceLabels = ctAnatomy.axial.map((s) => `${s.level} · ${s.label}`);
      scene.sliceCenters = ctAnatomy.axial.map((s) =>
        computeSliceCenters(s, scene.chestCx, scene.chestCy, scene.chestR));
      scene.sliceEdges = ctAnatomy.axial.map((s) => s.edges || []);
    }
    console.info(`[hero] CT anatomy loaded: ${ctAnatomy.axial.length} axial slices · source: ${source}`);
  }

  function sliceShapes(r, kind) {
    // body wall (most of the budget) + per-slice anatomy
    let pts = [];
    if (kind === 'apex') {
      // upper thoracic inlet: narrow body, two small high lungs, central trachea, no heart
      pts.push(...ellipse2D(0, 0, r * 0.95, r * 0.65, 90));
      pts.push(...bezier2D(
        { x:  0.18 * r, y: -0.22 * r }, { x:  0.62 * r, y: -0.28 * r },
        { x:  0.60 * r, y:  0.18 * r }, { x:  0.20 * r, y:  0.18 * r }, 36));
      pts.push(...bezier2D(
        { x: -0.18 * r, y: -0.22 * r }, { x: -0.62 * r, y: -0.28 * r },
        { x: -0.60 * r, y:  0.18 * r }, { x: -0.20 * r, y:  0.18 * r }, 36));
      pts.push(...ellipse2D(0, -0.08 * r, 0.07 * r, 0.07 * r, 18));   // trachea
      pts.push(...ellipse2D(-0.18 * r, -0.22 * r, 0.05 * r, 0.04 * r, 12)); // subclavian L
      pts.push(...ellipse2D( 0.18 * r, -0.22 * r, 0.05 * r, 0.04 * r, 12)); // subclavian R
      pts.push(...ellipse2D(0, 0.46 * r, 0.07 * r, 0.07 * r, 12));   // vertebra
      pts.push({ x: 0, y: 0.58 * r }, { x: -0.02 * r, y: 0.6 * r }, { x: 0.02 * r, y: 0.6 * r });
    } else if (kind === 'arch') {
      // aortic arch: wider body, lung areas growing, mediastinum dominated by arch sweep
      pts.push(...ellipse2D(0, 0, r * 1.00, r * 0.72, 100));
      pts.push(...bezier2D(
        { x:  0.22 * r, y: -0.32 * r }, { x:  0.78 * r, y: -0.40 * r },
        { x:  0.74 * r, y:  0.34 * r }, { x:  0.22 * r, y:  0.30 * r }, 36));
      pts.push(...bezier2D(
        { x: -0.22 * r, y: -0.32 * r }, { x: -0.78 * r, y: -0.40 * r },
        { x: -0.74 * r, y:  0.34 * r }, { x: -0.22 * r, y:  0.30 * r }, 36));
      pts.push(...bezier2D(
        { x: -0.10 * r, y: -0.18 * r }, { x: -0.05 * r, y: -0.30 * r },
        { x:  0.05 * r, y: -0.30 * r }, { x:  0.10 * r, y: -0.18 * r }, 14)); // arch top
      pts.push(...ellipse2D(0.04 * r, 0.04 * r, 0.06 * r, 0.06 * r, 10));    // descending aorta
      pts.push(...ellipse2D(0, -0.06 * r, 0.05 * r, 0.05 * r, 8));           // trachea
      pts.push(...ellipse2D(0, 0.48 * r, 0.07 * r, 0.07 * r, 12));           // vertebra
    } else if (kind === 'heart') {
      // 4-chamber heart: heart dominates anteriorly, both lungs flank, descending aorta posterior-left, target lesion in left lung
      pts.push(...ellipse2D(0, 0, r * 1.05, r * 0.78, 100));
      pts.push(...bezier2D(
        { x:  0.22 * r, y: -0.35 * r }, { x:  0.80 * r, y: -0.40 * r },
        { x:  0.78 * r, y:  0.42 * r }, { x:  0.22 * r, y:  0.35 * r }, 36));
      pts.push(...bezier2D(
        { x: -0.22 * r, y: -0.35 * r }, { x: -0.80 * r, y: -0.40 * r },
        { x: -0.78 * r, y:  0.42 * r }, { x: -0.22 * r, y:  0.35 * r }, 36));
      pts.push(...bezier2D(
        { x: -0.20 * r, y: -0.15 * r }, { x: -0.25 * r, y:  0.30 * r },
        { x:  0.20 * r, y:  0.30 * r }, { x:  0.18 * r, y: -0.10 * r }, 30));  // heart anterior
      pts.push(...ellipse2D(0.06 * r, 0.10 * r, 0.06 * r, 0.06 * r, 10));     // descending aorta
      pts.push(...ellipse2D(0, 0.50 * r, 0.07 * r, 0.07 * r, 12));            // vertebra
      pts.push(...ellipse2D(0.42 * r, -0.05 * r, 0.05 * r, 0.05 * r, 14));    // lesion target (left lung)
    } else {
      // diaphragm / liver dome: heart shrinks, liver appears right (viewer-left), spleen left, lungs reduced
      pts.push(...ellipse2D(0, 0, r * 1.04, r * 0.82, 100));
      pts.push(...bezier2D(
        { x:  0.30 * r, y: -0.30 * r }, { x:  0.78 * r, y: -0.30 * r },
        { x:  0.74 * r, y:  0.10 * r }, { x:  0.30 * r, y:  0.10 * r }, 30));
      pts.push(...bezier2D(
        { x: -0.30 * r, y: -0.30 * r }, { x: -0.78 * r, y: -0.30 * r },
        { x: -0.74 * r, y:  0.10 * r }, { x: -0.30 * r, y:  0.10 * r }, 30));
      pts.push(...bezier2D(
        { x: -0.78 * r, y:  0.05 * r }, { x: -0.85 * r, y:  0.30 * r },
        { x: -0.20 * r, y:  0.42 * r }, { x:  0.05 * r, y:  0.20 * r }, 36)); // liver dome (viewer-left)
      pts.push(...bezier2D(
        { x:  0.78 * r, y:  0.05 * r }, { x:  0.85 * r, y:  0.20 * r },
        { x:  0.40 * r, y:  0.30 * r }, { x:  0.20 * r, y:  0.20 * r }, 22)); // spleen (viewer-right)
      pts.push(...ellipse2D(-0.05 * r, -0.10 * r, 0.16 * r, 0.10 * r, 22));    // small heart remnant
      pts.push(...ellipse2D(0.06 * r, 0.18 * r, 0.05 * r, 0.05 * r, 10));      // descending aorta
      pts.push(...ellipse2D(0, 0.50 * r, 0.07 * r, 0.07 * r, 12));             // vertebra
    }
    // Pad / truncate to exactly SLICE_N points so slices can interpolate.
    if (pts.length > SLICE_N) pts = pts.slice(0, SLICE_N);
    while (pts.length < SLICE_N) pts.push(pts[pts.length % pts.length || 0]);
    return pts;
  }

  // ---- scene assembly ----
  function buildScene() {
    const s = Math.max(0.7, Math.min(W / 1500, H / 900));
    const dev = buildDevice3D(1.05 * s);

    // The device sits on the right edge; the CT scan sits on the left edge.
    // Pushed further out (was 0.72 / 0.30) so the centered headline doesn't
    // overlap either cloud at any reasonable viewport width.
    const devCx = W * 0.86;
    const devCy = H * 0.52;
    const chestCx = W * 0.14;
    const chestCy = H * 0.56;
    const chestR = 200 * Math.max(0.7, s);

    // Pre-build slice silhouettes. If the high-resolution JSON anatomy has
    // already loaded, use those 8 slices; otherwise use the 4-slice
    // hardcoded fallback. After-load swap is handled in loadCtAnatomy().
    let slices, sliceLabels, sliceCenters, sliceEdges;
    if (ctAnatomy && Array.isArray(ctAnatomy.axial)) {
      slices = ctAnatomy.axial.map((s) => {
        const norm = buildSliceAny(s);
        return norm.map((p) => ({ x: p.x * chestR, y: p.y * chestR, role: p.role }));
      });
      sliceLabels = ctAnatomy.axial.map((s) => `${s.level} · ${s.label}`);
      sliceCenters = ctAnatomy.axial.map((s) =>
        computeSliceCenters(s, chestCx, chestCy, chestR));
      sliceEdges = ctAnatomy.axial.map((s) => s.edges || []);
    } else {
      slices = ['apex', 'arch', 'heart', 'diaphragm'].map((k) => sliceShapes(chestR, k));
      sliceLabels = ['T2–T3 · Apex', 'T4 · Aortic Arch', 'T7 · 4-Chamber', 'T10 · Diaphragm'];
      sliceCenters = slices.map(() => ({}));
      sliceEdges = slices.map(() => []);
    }

    // The device particles need stable target indices that align with verts[i].
    // The chest particles need target indices that match the i-th slice point;
    // we interpolate between current slice and next slice on a slow timer.
    const totalDev = dev.verts.length;
    const totalChest = SLICE_N;
    const total = totalDev + totalChest;

    if (particles.length !== total) {
      particles = new Array(total);
      // Compute *initial* targets (yaw=theta=psi=0, slice 0) and spawn each
      // particle AT its target plus a small jitter so the cloud never has
      // to "fly in" from random positions across the canvas — that snap-in
      // was reading as elastic / weird.
      for (let i = 0; i < total; i++) {
        const isDev = i < totalDev;
        let ix = 0, iy = 0;
        if (isDev) {
          const v = dev.verts[i];
          // identity model rotations, only the fixed camera tilt
          const y_c = v.y * Math.cos(TILT) - v.z * Math.sin(TILT);
          const z_c = v.y * Math.sin(TILT) + v.z * Math.cos(TILT);
          const persp = 1 + z_c * 0.0018;
          ix = devCx + v.x * persp;
          iy = devCy - y_c * persp;
        } else {
          // slice 0 (apex)
          const sp = slices[0][i - totalDev];
          ix = chestCx + sp.x;
          iy = chestCy + sp.y;
        }
        // small jitter so the cloud doesn't look perfectly geometric
        const jitter = 8;
        ix += (Math.random() - 0.5) * jitter;
        iy += (Math.random() - 0.5) * jitter;

        particles[i] = {
          x: ix, y: iy,
          vx: 0, vy: 0,
          tx: ix, ty: iy,
          phase: Math.random() * TAU,
          freq: 0.3 + Math.random() * 0.6,
          amp: 0.6 + Math.random() * 1.2,
          layer: isDev ? dev.verts[i].layer : 'chest',
          si: isDev ? -1 : (i - totalDev),
          dx: isDev ? dev.verts[i].x : 0,
          dy: isDev ? dev.verts[i].y : 0,
          dz: isDev ? dev.verts[i].z : 0,
        };
      }
    } else {
      // resize: refresh 3D coords + slice-relative indices in case scale changed
      for (let i = 0; i < totalDev; i++) {
        particles[i].layer = dev.verts[i].layer;
        particles[i].dx = dev.verts[i].x;
        particles[i].dy = dev.verts[i].y;
        particles[i].dz = dev.verts[i].z;
      }
    }

    return {
      device: dev,
      slices,
      sliceLabels,
      sliceCenters,
      sliceEdges,
      devCx, devCy, chestCx, chestCy, chestR,
      totalDev,
    };
  }

  function resize() {
    W = canvas.clientWidth = canvas.offsetWidth;
    H = canvas.clientHeight = canvas.offsetHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    scene = buildScene();

    // Ambient atmosphere particles. Density scales with canvas area so the
    // background reads the same on mobile and desktop. These have no target
    // position — they just drift in the flow field and wrap at edges.
    const targetN = Math.round(Math.min(460, Math.max(220, (W * H) / 3400)));
    if (ambient.length !== targetN) {
      ambient = new Array(targetN);
      for (let i = 0; i < targetN; i++) {
        ambient[i] = {
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          phase: Math.random() * TAU,
          freq: 0.15 + Math.random() * 0.4,
          size: 0.7 + Math.random() * 1.0,
          alpha: 0.22 + Math.random() * 0.36,
        };
      }
    }
  }

  // ---- animation ----
  let lastT = performance.now();
  // Particles already spawn at their target positions (see buildScene),
  // so there's no swarm-in to fade. Start `formed` at 1 so dots render at
  // full opacity from the very first frame — no perceptible "dots didn't
  // start yet" pause when the user lands on the page.
  let formed = 1;          // 0..1 swarm-into-place progress
  let deviceYaw = 0;       // rotation around vertical axis
  let sliceClock = 0;      // 0..N progress through slice cycle
  let rafId = null;
  let visible = true;      // toggled by IntersectionObserver

  // Tilt the device camera 22deg "downward" so the disc top face shows as
  // an ellipse rather than a flat horizontal line. This is what makes the
  // yaw rotation legible — without tilt, the puck looks like a thin slab
  // spinning around its own thinness.
  const TILT = 22 * Math.PI / 180;
  const COS_T = Math.cos(TILT), SIN_T = Math.sin(TILT);

  // Curl-of-sinusoids flow field. Returns (fx, fy) for a point (x, y) at
  // time t. Cheap, divergence-free-ish, and creates the soft "swimming"
  // motion that reads as ethereal.
  function flow(x, y, t) {
    const fx =
      Math.sin(y * 0.0085 + t * 0.30) +
      Math.cos(x * 0.0061 + t * 0.20) * 0.7;
    const fy =
      Math.cos(x * 0.0090 + t * 0.27) +
      Math.sin(y * 0.0055 + t * 0.18) * 0.7 -
      0.20; // gentle bias upward, like rising particles
    return [fx, fy];
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    // Particles already spawn at their targets (see buildScene), so this is
    // a pure alpha fade-in over ~0.5 s — no elastic snap-in.
    if (formed < 1) formed = Math.min(1, formed + dt * 2.0);
    if (!reduceMotion) {
      deviceYaw += dt * 0.28;        // slow, deliberate rotation
      sliceClock += dt * 0.20;       // ~5s per slice transition pair
    }
    const ease = formed < 1 ? (1 - Math.pow(1 - formed, 3)) : 1;

    // recompute device targets (yaw + theta/psi angulation + camera tilt +
    // perspective) and chest morphs. theta and psi oscillate so the device
    // visibly "angulates" the way a clinician would aim the needle into
    // skin at an entry angle in the sagittal and coronal planes.
    if (scene) {
      const { device: dev, slices, devCx, devCy, chestCx, chestCy, totalDev } = scene;
      const cosY = Math.cos(deviceYaw), sinY = Math.sin(deviceYaw);

      // angulation: model rotations applied after yaw, before camera tilt.
      // theta ~= sagittal-plane angle (rotation around X), psi ~= coronal-plane
      // angle (rotation around Z). Two slow primary oscillations + a slower
      // secondary harmonic so the values feel "live and noisy" not periodic.
      const t = now * 0.001;
      const theta = 0.18 * Math.sin(t * 0.55) + 0.05 * Math.sin(t * 0.13 + 0.4);
      const psi   = 0.22 * Math.sin(t * 0.41 + 1.3) + 0.06 * Math.sin(t * 0.17 + 1.1);
      // Update HUD readout if it exists. Throttled — only writes when the
      // tenths-of-a-degree value actually changes, so we don't thrash the DOM.
      if (hudTheta) updateHud(hudTheta, '_theta', theta);
      if (hudPsi)   updateHud(hudPsi,   '_psi',   psi);
      const cTh = Math.cos(theta), sTh = Math.sin(theta);
      const cPs = Math.cos(psi),   sPs = Math.sin(psi);

      for (let i = 0; i < totalDev; i++) {
        const p = particles[i];
        // 1) yaw around Y axis (continuous rotation)
        let x = p.dx * cosY + p.dz * sinY;
        let y = p.dy;
        let z = -p.dx * sinY + p.dz * cosY;
        // 2) theta around X axis (sagittal angulation)
        const y_t = y * cTh - z * sTh;
        const z_t = y * sTh + z * cTh;
        y = y_t; z = z_t;
        // 3) psi around Z axis (coronal angulation)
        const x_p = x * cPs - y * sPs;
        const y_p = x * sPs + y * cPs;
        x = x_p; y = y_p;
        // 4) camera tilt around X axis (we look 22° down)
        const y_c = y * COS_T - z * SIN_T;
        const z_c = y * SIN_T + z * COS_T;
        const persp = 1 + z_c * 0.0018;
        p.tx = devCx + x * persp;
        p.ty = devCy - y_c * persp;
        p.depth = z_c;
      }

      // Slice transition: position-lerp between adjacent slices. Because
      // we build slices with role-grouped indices (see buildSliceByRole),
      // particle i is always the same anatomical role across slices and
      // travels a SHORT distance between A[i] and B[i] — efficient morph,
      // no cross-slice traversal.
      const sliceIndex = Math.floor(sliceClock) % slices.length;
      const sliceNext  = (sliceIndex + 1) % slices.length;
      const tSlice = sliceClock - Math.floor(sliceClock);
      const k = tSlice * tSlice * (3 - 2 * tSlice);
      const A = slices[sliceIndex], B = slices[sliceNext];
      for (let i = 0; i < SLICE_N; i++) {
        const p = particles[totalDev + i];
        const a = A[i], b = B[i];
        p.tx = chestCx + a.x + (b.x - a.x) * k;
        p.ty = chestCy + a.y + (b.y - a.y) * k;
        p.role = a.role || 'soft';  // role stable across slices anyway
        p.alpha = 1;
      }
    }

    // Loose spring + curl-noise drift. Stiffness is intentionally low so
    // particles "breathe" around their targets instead of locking on.
    // Chest particles SKIP the spring — they snap to slice targets so
    // particles vanish at one slice and reappear at the next (vs morphing).
    const tNow = now * 0.001;
    const ks = 1.7;
    const damp = 0.93;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const dx = p.tx - p.x, dy = p.ty - p.y;
      p.vx = (p.vx + dx * ks * dt) * damp;
      p.vy = (p.vy + dy * ks * dt) * damp;
      if (!reduceMotion && formed > 0.6) {
        const drift = 0.55 * p.amp;
        const [fx, fy] = flow(p.x, p.y, tNow * p.freq + p.phase);
        p.vx += fx * drift * dt;
        p.vy += fy * drift * dt;
      }
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
    }

    // Ambient atmosphere: pure flow-field drift with edge wrap. No spring
    // target. Speed is intentionally low so the background reads as still
    // air rather than a swarm.
    if (!reduceMotion) {
      for (let i = 0; i < ambient.length; i++) {
        const p = ambient[i];
        const [fx, fy] = flow(p.x, p.y, tNow * p.freq + p.phase);
        p.vx = (p.vx + fx * 0.25 * dt) * 0.96;
        p.vy = (p.vy + fy * 0.25 * dt) * 0.96;
        p.x += p.vx * dt * 30;
        p.y += p.vy * dt * 30;
        // wrap with a small margin so re-entry is gentle
        const m = 24;
        if (p.x < -m) p.x = W + m;
        else if (p.x > W + m) p.x = -m;
        if (p.y < -m) p.y = H + m;
        else if (p.y > H + m) p.y = -m;
      }
    }

    draw(now, ease);
    if (!reduceMotion && visible) rafId = requestAnimationFrame(frame);
  }

  function draw(now, ease) {
    ctx.clearRect(0, 0, W, H);

    // ---- ambient atmosphere layer (drawn first / behind everything) ----
    // Connections among ambient particles within a moderate radius. A
    // per-frame time-based pulse modulates each pair's alpha so the network
    // visually "cycles" — different pairs read as connected at different
    // moments without us needing to actually rewire neighbours each frame.
    if (ambient.length) {
      const ar = 120, ar2 = ar * ar;
      const tPulse = (now || performance.now()) * 0.0007;
      ctx.lineWidth = 0.75;
      for (let i = 0; i < ambient.length; i++) {
        const a = ambient[i];
        for (let j = i + 1; j < ambient.length; j++) {
          const b = ambient[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < ar2) {
            // Smoothstep falloff (less linear-looking than 1 - d²/r²)
            const t = d2 / ar2;
            const s = (1 - t) * (1 - t);
            // per-pair cyclic shimmer; (i*7+j*13) gives a stable seed-like
            // offset so each pair's pulse phase is different
            const shimmer = 0.55 + 0.45 * Math.sin(tPulse + (i * 7 + j * 13) * 0.13);
            const alpha = s * 0.13 * shimmer * ease;
            ctx.strokeStyle = `rgba(140, 180, 230, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      for (let i = 0; i < ambient.length; i++) {
        const a = ambient[i];
        ctx.fillStyle = `rgba(170, 200, 235, ${a.alpha * 0.90 * ease})`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.size, 0, TAU);
        ctx.fill();
      }
    }

    // Connection lines — sparser and softer than before. Only same-layer
    // particles connect, and only within a smaller radius, so the cloud
    // reads as a constellation rather than a wireframe.
    const r = 34, r2 = r * r;
    const N = particles.length;
    ctx.lineWidth = 0.75;
    for (let i = 0; i < N; i++) {
      const a = particles[i];
      for (let j = i + 1; j < N; j++) {
        const b = particles[j];
        const sameLayer =
          a.layer === b.layer ||
          (a.layer.startsWith('device') && b.layer.startsWith('device'));
        if (!sameLayer) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2) {
          let alpha = (1 - d2 / r2) * 0.11 * ease;
          if (a.layer.startsWith('device')) {
            const depthTint = Math.min(1, Math.max(0, (a.depth || 0) / 80 + 0.5));
            ctx.strokeStyle = `rgba(94, 234, 212, ${alpha * (0.4 + 0.6 * depthTint)})`;
          } else {
            // chest: also fade lines with slice fade
            const aA = a.alpha == null ? 1 : a.alpha;
            const bA = b.alpha == null ? 1 : b.alpha;
            alpha *= Math.min(aA, bA);
            if (alpha <= 0.005) continue;
            ctx.strokeStyle = `rgba(165, 180, 252, ${alpha * 0.85})`;
          }
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // Particles: soft, slightly larger with a glow halo so the cloud reads
    // as luminous rather than dot-matrix. Uses canvas shadowBlur which is
    // cheap enough at our particle count and gives free bokeh.
    ctx.save();
    ctx.shadowBlur = 8;
    for (let i = 0; i < N; i++) {
      const p = particles[i];
      const isDev = p.layer.startsWith('device');
      const isDot = p.layer === 'device-dot';
      let alpha = 0.75 * ease;
      if (isDev) {
        const d = Math.min(1, Math.max(0, (p.depth || 0) / 80 + 0.5));
        alpha *= 0.40 + 0.60 * d;
      }
      let colour;
      if (isDot) {
        colour = `rgba(94, 234, 212, ${0.95 * ease})`;
      } else if (isDev) {
        colour = `rgba(214, 244, 252, ${alpha})`;
      } else {
        // chest: role-based tint + slice fade-out / fade-in alpha
        const tint = ROLE_COLOR[p.role] || ROLE_COLOR.soft;
        const chestA = (p.alpha == null ? 1 : p.alpha) * 0.85 * ease;
        if (chestA <= 0.01) continue;       // skip fully-faded particles
        colour = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${chestA})`;
      }
      ctx.shadowColor = isDev
        ? 'rgba(94, 234, 212, 0.55)'
        : 'rgba(120, 150, 255, 0.42)';
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isDot ? 3.4 : (isDev ? 1.25 : 1.15), 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Vessel-connector edges: faint cyan lines between named shape centres,
    // present only when the JSON anatomy is loaded. We cross-fade the two
    // adjacent slices' edge sets across the slice transition so vessels
    // don't snap on/off. Per-edge phase modulation gives the network the
    // same shimmer feel as the ambient connections.
    if (scene && scene.sliceEdges && scene.sliceEdges.length > 0) {
      const n = scene.slices.length;
      const sliceIndex = Math.floor(sliceClock) % n;
      const sliceNext  = (sliceIndex + 1) % n;
      const tSlice = sliceClock - Math.floor(sliceClock);
      const tPulse = now * 0.0006;

      function drawEdgeSet(idx, blend) {
        const edges = scene.sliceEdges[idx];
        const centres = scene.sliceCenters[idx];
        if (!edges || !centres) return;
        ctx.lineWidth = 0.8;
        for (let e = 0; e < edges.length; e++) {
          const [a, b] = edges[e];
          const pa = centres[a], pb = centres[b];
          if (!pa || !pb) continue;
          const shimmer = 0.55 + 0.45 * Math.sin(tPulse + e * 0.9 + idx * 0.4);
          const alpha = 0.30 * blend * shimmer * ease;
          ctx.strokeStyle = `rgba(94, 234, 212, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
          // tiny node dots at each endpoint
          ctx.fillStyle = `rgba(94, 234, 212, ${alpha * 1.4})`;
          ctx.beginPath(); ctx.arc(pa.x, pa.y, 1.8, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(pb.x, pb.y, 1.8, 0, TAU); ctx.fill();
        }
      }
      drawEdgeSet(sliceIndex, 1 - tSlice);
      drawEdgeSet(sliceNext,  tSlice);
    }

    // Slice label below the chest cloud.
    if (scene) {
      const labels = scene.sliceLabels || ['T2–T3 · Apex', 'T4 · Aortic Arch', 'T7 · 4-Chamber', 'T10 · Diaphragm'];
      const idx = Math.floor(sliceClock) % labels.length;
      ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = `rgba(189, 205, 250, ${0.5 * ease})`;
      ctx.fillText(labels[idx], scene.chestCx - scene.chestR, scene.chestCy + scene.chestR + 30);
    }
  }

  // ---- boot ----
  window.addEventListener('resize', () => {
    cancelAnimationFrame(window.__ngpsRz);
    window.__ngpsRz = requestAnimationFrame(resize);
  });

  // Pause the animation when the hero scrolls offscreen so we don't burn
  // CPU/GPU on a canvas the user isn't looking at. Resume on re-entry,
  // resetting the dt clock so we don't get a single huge step.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !visible) {
          visible = true;
          lastT = performance.now();
          if (!reduceMotion && !rafId) rafId = requestAnimationFrame(frame);
        } else if (!e.isIntersecting && visible) {
          visible = false;
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        }
      }
    }, { rootMargin: '64px' });
    io.observe(canvas);
  }

  resize();
  // Kick off the high-resolution anatomy fetch in parallel. When it resolves
  // it'll swap the slice point clouds in place; the running animation
  // smoothly morphs into the richer data on the next frame.
  loadCtAnatomy();

  if (reduceMotion) {
    for (const p of particles) { p.x = p.tx; p.y = p.ty; }
    formed = 1;
    draw(performance.now(), 1);
  } else {
    rafId = requestAnimationFrame(frame);
  }
})();
