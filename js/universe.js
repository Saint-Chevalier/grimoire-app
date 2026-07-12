/**
 * Grimoire Universe Engine — each Focus is its own cosmos.
 * Canvas-only, deterministic from focus state, rAF + performance caps.
 * No DOM stars. No libraries.
 */

const MAX_ANIM_STARS = 400;
const STAGES = [
  { id: 0, name: "VOID", minIntel: 0, minSent: 0 },
  { id: 1, name: "IGNITION", minIntel: 0, minSent: 0, needsAlign: true },
  { id: 2, name: "EXPANSION", minIntel: 5, minSent: 0 },
  { id: 3, name: "CONSTELLATION", minIntel: 10, minSent: 3 },
  { id: 4, name: "GALAXY", minIntel: 25, minSent: 0 },
  { id: 5, name: "COSMOS", minIntel: 50, minSent: 0 },
];

/** @type {HTMLCanvasElement|null} */
let canvas = null;
/** @type {CanvasRenderingContext2D|null} */
let ctx = null;
let rafId = 0;
let lastTs = 0;
let running = false;
let mouseX = 0.5;
let mouseY = 0.5;
let targetMouseX = 0.5;
let targetMouseY = 0.5;

/** @type {UniverseState|null} */
let uni = null;
let warpT = 0; // 0 idle, >0 warping out, <0 warping in
let stageFlash = 0;
let lastStageId = -1;
let lastSwitchAt = 0;
let onHud = null;

/**
 * @typedef {Object} UniverseState
 * @property {string} focusId
 * @property {string} name
 * @property {number} seed
 * @property {number} signal
 * @property {boolean} aligned
 * @property {number} intelCount
 * @property {number} imageCount
 * @property {number} pulseCount
 * @property {number} stage
 * @property {string} stageName
 * @property {Array} dust
 * @property {Array} staticStars
 * @property {Array} stars
 * @property {Array} planets
 * @property {Array} nebulae
 * @property {Array} lines
 * @property {Array} comets
 * @property {Array} ripples
 * @property {Object|null} sun
 * @property {number} time
 * @property {Object} palette
 */

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str || "void");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function rng() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pickPalette(rng) {
  const bases = [
    { a: [167, 139, 250], b: [96, 165, 250], c: [240, 215, 140] },
    { a: [52, 211, 153], b: [96, 165, 250], c: [167, 139, 250] },
    { a: [251, 146, 60], b: [244, 114, 182], c: [250, 204, 21] },
    { a: [56, 189, 248], b: [129, 140, 248], c: [255, 255, 255] },
    { a: [244, 63, 94], b: [168, 85, 247], c: [251, 191, 36] },
  ];
  return bases[Math.floor(rng() * bases.length)];
}

export function universeStage(intelCount, spellsSent, aligned) {
  let stage = STAGES[0];
  if (aligned) stage = STAGES[1];
  for (let i = 2; i < STAGES.length; i++) {
    const s = STAGES[i];
    if (intelCount >= s.minIntel && spellsSent >= (s.minSent || 0)) stage = s;
  }
  if (!aligned && intelCount === 0) stage = STAGES[0];
  return stage;
}

/**
 * Count intel bits from convo messages (deterministic).
 */
export function deriveFocusSnapshot(convo, spells) {
  if (!convo) {
    return {
      focusId: null,
      name: "",
      intelCount: 0,
      imageCount: 0,
      pulseCount: 0,
      signal: 5,
      aligned: false,
      directives: 0,
      spellsTotal: 0,
      spellsSent: 0,
      spellsReady: 0,
    };
  }
  const msgs = convo.messages || [];
  let intelCount = 0;
  let imageCount = 0;
  for (const m of msgs) {
    if (m.role === "user") {
      intelCount += 1;
      if (Array.isArray(m.images)) imageCount += m.images.length;
    }
  }
  if (convo.alignmentReceived || convo.alignmentRevealed || convo.alignmentNotes) {
    intelCount = Math.max(intelCount, 1);
  }
  const focusSpells = (spells || []).filter((s) => s.conversationId === convo.id);
  const spellsSent = focusSpells.filter((s) => s.status === "sent").length;
  const spellsReady = focusSpells.filter((s) => s.status !== "sent").length;
  const dirs = convo.alignmentProfile?.directives?.length || 0;
  const signal =
    convo.alignmentProfile?.signal != null
      ? Number(convo.alignmentProfile.signal)
      : 5;
  const aligned = Boolean(
    convo.alignmentRevealed || convo.alignmentReceived || convo.alignmentNotes
  );

  return {
    focusId: convo.id,
    name: convo.name || "",
    intelCount,
    imageCount,
    pulseCount: convo.pulseCount || 0,
    signal: Math.max(1, Math.min(10, signal || 5)),
    aligned,
    directives: dirs,
    spellsTotal: focusSpells.length,
    spellsSent,
    spellsReady,
    focusSpells,
  };
}

function buildUniverse(snapshot) {
  const seed = hashSeed(snapshot.focusId || "void");
  const rng = makeRng(seed);
  const palette = pickPalette(rng);
  const stage = universeStage(
    snapshot.intelCount,
    snapshot.spellsSent,
    snapshot.aligned
  );

  // Distant dust (parallax layer 0)
  const dust = [];
  for (let i = 0; i < 80; i++) {
    dust.push({
      x: rng(),
      y: rng(),
      r: 0.3 + rng() * 1.2,
      a: 0.04 + rng() * 0.08,
      layer: 0,
    });
  }

  // Base void: 20 faint distant stars
  const staticStars = [];
  for (let i = 0; i < 20; i++) {
    staticStars.push({
      x: rng(),
      y: rng(),
      r: 0.6 + rng() * 1.1,
      a: 0.15 + rng() * 0.25,
      tw: rng() * Math.PI * 2,
      layer: 1,
    });
  }

  // Intel stars — deterministic positions from seed + index
  const stars = [];
  const starTarget = Math.min(
    MAX_ANIM_STARS,
    20 + snapshot.intelCount * 6 + snapshot.spellsTotal * 2
  );
  for (let i = 0; i < starTarget; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = 0.08 + rng() * 0.42;
    stars.push({
      x: 0.5 + Math.cos(ang) * dist * (0.7 + rng() * 0.5),
      y: 0.48 + Math.sin(ang) * dist * 0.75,
      r: 1 + rng() * 1.8,
      a: 0.45 + rng() * 0.45,
      hue: rng(),
      tw: rng() * Math.PI * 2,
      spawn: 0, // already settled on rebuild
      layer: 2,
    });
  }

  // Planets from directives (max 8)
  const planets = [];
  const pCount = Math.min(8, snapshot.directives || 0);
  for (let i = 0; i < pCount; i++) {
    planets.push({
      orbit: 0.08 + i * 0.035 + rng() * 0.01,
      angle: rng() * Math.PI * 2,
      speed: 0.12 + rng() * 0.18 + i * 0.02,
      r: 2.5 + rng() * 2.5,
      color: i % 2 === 0 ? palette.a : palette.b,
      phase: rng() * Math.PI * 2,
    });
  }

  // Nebulae from images
  const nebulae = [];
  for (let i = 0; i < (snapshot.imageCount || 0); i++) {
    const ang = rng() * Math.PI * 2;
    const dist = 0.12 + rng() * 0.3;
    nebulae.push({
      x: 0.5 + Math.cos(ang) * dist,
      y: 0.48 + Math.sin(ang) * dist * 0.8,
      r: 40 + rng() * 70,
      color: i % 3 === 0 ? palette.a : i % 3 === 1 ? palette.b : palette.c,
      a: 0.08 + rng() * 0.1,
      rot: rng() * Math.PI * 2,
    });
  }

  // Locked lines from sent spells
  const lines = [];
  const sent = snapshot.spellsSent || 0;
  for (let i = 0; i < sent && i < 40; i++) {
    const a = stars[i % Math.max(1, stars.length)];
    const b = stars[(i * 3 + 7) % Math.max(1, stars.length)];
    if (a && b && a !== b) {
      lines.push({
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        a: 0.2 + rng() * 0.15,
        locked: true,
      });
    }
  }

  const sun = snapshot.aligned
    ? {
        x: 0.5,
        y: 0.48,
        r: 6,
        ignition: 0,
        pulse: 0,
      }
    : null;

  return {
    focusId: snapshot.focusId,
    name: snapshot.name,
    seed,
    signal: snapshot.signal,
    aligned: snapshot.aligned,
    intelCount: snapshot.intelCount,
    imageCount: snapshot.imageCount,
    pulseCount: snapshot.pulseCount,
    stage: stage.id,
    stageName: stage.name,
    dust,
    staticStars,
    stars,
    planets,
    nebulae,
    lines,
    comets: [],
    ripples: [],
    sun,
    time: 0,
    palette,
    starCount: staticStars.length + stars.length + (sun ? 1 : 0),
  };
}

export function initUniverse(canvasEl, opts = {}) {
  canvas = canvasEl;
  if (!canvas) return;
  ctx = canvas.getContext("2d", { alpha: false });
  onHud = opts.onHud || null;

  const resize = () => {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  window.addEventListener(
    "mousemove",
    (e) => {
      targetMouseX = e.clientX / Math.max(1, window.innerWidth);
      targetMouseY = e.clientY / Math.max(1, window.innerHeight);
    },
    { passive: true }
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLoop();
    else startLoop();
  });

  startLoop();
}

function startLoop() {
  if (running) return;
  running = true;
  lastTs = 0;
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function frame(ts) {
  if (!running) return;
  rafId = requestAnimationFrame(frame);
  if (!ctx || !canvas) return;
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
  lastTs = ts;

  mouseX += (targetMouseX - mouseX) * 0.04;
  mouseY += (targetMouseY - mouseY) * 0.04;

  if (uni) {
    uni.time += dt;
    tickUniverse(uni, dt);
  }
  if (stageFlash > 0) stageFlash = Math.max(0, stageFlash - dt);
  if (warpT !== 0) {
    if (warpT > 0) {
      warpT += dt;
      if (warpT >= 0.2) {
        // midpoint — universe already swapped
        warpT = -0.001;
      }
    } else {
      warpT -= dt;
      if (warpT <= -0.2) warpT = 0;
    }
  }

  draw(dt);
}

function tickUniverse(u, dt) {
  for (const p of u.planets) {
    p.angle += p.speed * dt;
  }
  for (const s of u.stars) {
    if (s.spawn > 0) s.spawn = Math.max(0, s.spawn - dt / 0.6);
  }
  if (u.sun) {
    u.sun.pulse += dt;
    if (u.sun.ignition > 0) u.sun.ignition = Math.max(0, u.sun.ignition - dt / 1.5);
  }
  // Comets — trail becomes a permanent constellation line
  for (let i = u.comets.length - 1; i >= 0; i--) {
    const c = u.comets[i];
    c.t += dt / c.dur;
    if (c.t >= 1) {
      u.lines.push({
        x1: c.x1,
        y1: c.y1,
        x2: c.x2,
        y2: c.y2,
        a: 0.22,
        locked: false,
      });
      u.comets.splice(i, 1);
    }
  }
  for (let i = u.ripples.length - 1; i >= 0; i--) {
    u.ripples[i].r += dt * 0.55;
    u.ripples[i].a -= dt * 0.7;
    if (u.ripples[i].a <= 0) u.ripples.splice(i, 1);
  }
  u.starCount = u.staticStars.length + u.stars.length + (u.sun ? 1 : 0);
}

function draw() {
  if (!ctx || !canvas) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const px = (mouseX - 0.5) * 18;
  const py = (mouseY - 0.5) * 12;

  // Deep space
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

  const brightness = uni
    ? 0.55 + (uni.signal / 10) * 0.55
    : 0.5;

  if (!uni) {
    drawWarpOverlay(w, h);
    return;
  }

  const u = uni;
  const pal = u.palette;

  // Layer 0 dust
  ctx.save();
  ctx.translate(px * 0.15, py * 0.15);
  for (const d of u.dust) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(180,190,255,${d.a * brightness})`;
    ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Nebulae
  ctx.save();
  ctx.translate(px * 0.35, py * 0.35);
  for (const n of u.nebulae) {
    const grd = ctx.createRadialGradient(
      n.x * w,
      n.y * h,
      0,
      n.x * w,
      n.y * h,
      n.r
    );
    const [r, g, b] = n.color;
    grd.addColorStop(0, `rgba(${r},${g},${b},${n.a * brightness})`);
    grd.addColorStop(0.5, `rgba(${r},${g},${b},${n.a * 0.4 * brightness})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(n.x * w, n.y * h, n.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Static distant stars
  ctx.save();
  ctx.translate(px * 0.5, py * 0.5);
  for (const s of u.staticStars) {
    const tw = 0.7 + 0.3 * Math.sin(u.time * 1.2 + s.tw);
    ctx.beginPath();
    ctx.fillStyle = `rgba(220,225,255,${s.a * tw * brightness})`;
    ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Locked constellation lines
  ctx.save();
  ctx.translate(px * 0.7, py * 0.7);
  for (const ln of u.lines) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${pal.a[0]},${pal.a[1]},${pal.a[2]},${ln.a * brightness})`;
    ctx.lineWidth = ln.locked ? 1.1 : 0.7;
    ctx.moveTo(ln.x1 * w, ln.y1 * h);
    ctx.lineTo(ln.x2 * w, ln.y2 * h);
    ctx.stroke();
  }
  ctx.restore();

  // Intel stars (layer 2)
  ctx.save();
  ctx.translate(px * 0.85, py * 0.85);
  for (const s of u.stars) {
    const spawnBoost = s.spawn > 0 ? 1 + s.spawn * 2.5 : 1;
    const tw = 0.75 + 0.25 * Math.sin(u.time * 2 + s.tw);
    const alpha = Math.min(1, s.a * tw * brightness * (s.spawn > 0 ? 0.4 + (1 - s.spawn) : 1));
    const r = s.r * spawnBoost;
    const x = s.x * w;
    const y = s.y * h;
    if (s.spawn > 0) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${0.35 * s.spawn})`;
      ctx.arc(x, y, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.fillStyle = `rgba(230,235,255,${alpha})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Planets
  if (u.sun) {
    ctx.save();
    ctx.translate(px, py);
    const sx = u.sun.x * w;
    const sy = u.sun.y * h;
    for (const p of u.planets) {
      const pxp = sx + Math.cos(p.angle) * p.orbit * Math.min(w, h);
      const pyp = sy + Math.sin(p.angle) * p.orbit * Math.min(w, h) * 0.72;
      // orbit path faint
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,255,255,${0.04 * brightness})`;
      ctx.lineWidth = 0.6;
      ctx.ellipse(sx, sy, p.orbit * Math.min(w, h), p.orbit * Math.min(w, h) * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
      const [r, g, b] = p.color;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${r},${g},${b},${0.85 * brightness})`;
      ctx.shadowColor = `rgba(${r},${g},${b},0.5)`;
      ctx.shadowBlur = 8;
      ctx.arc(pxp, pyp, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // Sun
  if (u.sun) {
    ctx.save();
    ctx.translate(px, py);
    const sx = u.sun.x * w;
    const sy = u.sun.y * h;
    const ign = u.sun.ignition; // 1 → 0
    const pulse = 1 + 0.12 * Math.sin(u.sun.pulse * 2.2);
    const baseR = (6 + ign * 14) * pulse;
    const corona = ctx.createRadialGradient(sx, sy, 0, sx, sy, baseR * 12);
    const [r, g, b] = pal.c;
    corona.addColorStop(0, `rgba(255,255,255,${0.55 * brightness})`);
    corona.addColorStop(0.15, `rgba(${r},${g},${b},${0.35 * brightness})`);
    corona.addColorStop(0.4, `rgba(${pal.a[0]},${pal.a[1]},${pal.a[2]},${0.12 * brightness})`);
    corona.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(sx, sy, baseR * 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,250,230,${0.95 * brightness})`;
    ctx.shadowColor = `rgba(${r},${g},${b},0.9)`;
    ctx.shadowBlur = 24 + ign * 40;
    ctx.arc(sx, sy, baseR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // Comets
  ctx.save();
  ctx.translate(px * 0.9, py * 0.9);
  for (const c of u.comets) {
    const t = c.t;
    const x = (c.x1 + (c.x2 - c.x1) * t) * w;
    const y = (c.y1 + (c.y2 - c.y1) * t) * h;
    const tx = (c.x1 + (c.x2 - c.x1) * Math.max(0, t - 0.12)) * w;
    const ty = (c.y1 + (c.y2 - c.y1) * Math.max(0, t - 0.12)) * h;
    const grad = ctx.createLinearGradient(tx, ty, x, y);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, `rgba(220,230,255,${0.9 * (1 - t)})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${1 - t * 0.5})`;
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Pulse ripples (from sun, or void center)
  if (u.ripples.length) {
    ctx.save();
    ctx.translate(px, py);
    const sx = (u.sun?.x ?? 0.5) * w;
    const sy = (u.sun?.y ?? 0.48) * h;
    for (const rp of u.ripples) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(200,190,255,${Math.max(0, rp.a)})`;
      ctx.lineWidth = 1.5;
      ctx.arc(sx, sy, rp.r * Math.min(w, h), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Stage flash
  if (stageFlash > 0) {
    ctx.fillStyle = `rgba(200,190,255,${0.12 * stageFlash})`;
    ctx.fillRect(0, 0, w, h);
  }

  drawWarpOverlay(w, h);
}

function drawWarpOverlay(w, h) {
  if (warpT === 0 || !ctx) return;
  const abs = Math.abs(warpT);
  const t = Math.min(1, abs / 0.2);
  if (warpT > 0) {
    // streak out
    ctx.fillStyle = `rgba(0,0,0,${t * 0.85})`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = `rgba(220,220,255,${0.25 * (1 - t)})`;
    for (let i = 0; i < 40; i++) {
      const x = (i / 40) * w;
      const y = ((i * 37) % 100) / 100 * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (0.5 - mouseX) * 80 * t, y + (0.5 - mouseY) * 80 * t);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = `rgba(0,0,0,${(1 - t) * 0.9})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/**
 * Switch / rebuild universe for a focus snapshot.
 */
export function setFocusUniverse(snapshot, { warp = true } = {}) {
  const now = performance.now();
  const rapid = now - lastSwitchAt < 350;
  lastSwitchAt = now;

  const next = snapshot?.focusId ? buildUniverse(snapshot) : null;
  const same = uni && next && uni.focusId === next.focusId;

  if (same) {
    // Soft rebuild — preserve transient effects, refresh counts
    applySnapshotDiff(uni, snapshot, next);
    emitHud();
    return uni;
  }

  if (warp && !rapid && uni && next) {
    warpT = 0.001;
    // swap at midpoint of warp
    setTimeout(() => {
      uni = next;
      checkStageFlash(next);
      emitHud();
    }, 200);
  } else {
    uni = next;
    checkStageFlash(next);
  }
  emitHud();
  return uni;
}

function applySnapshotDiff(u, snap, rebuilt) {
  if (!u || !snap) return;
  const wasAligned = u.aligned;
  u.aligned = snap.aligned;
  u.signal = snap.signal;
  u.intelCount = snap.intelCount;
  u.imageCount = snap.imageCount;
  u.pulseCount = snap.pulseCount;

  if (snap.aligned && !wasAligned) {
    u.sun = { x: 0.5, y: 0.48, r: 6, ignition: 1, pulse: 0 };
    spawnStars(u, 6, true);
  } else if (snap.aligned && !u.sun) {
    u.sun = { x: 0.5, y: 0.48, r: 6, ignition: 0, pulse: 0 };
  }

  // Grow stars to target
  const target = Math.min(
    MAX_ANIM_STARS,
    20 + snap.intelCount * 6 + snap.spellsTotal * 2
  );
  while (u.stars.length < target) {
    spawnStars(u, 1, false);
  }

  // Planets
  while (u.planets.length < Math.min(8, snap.directives || 0)) {
    const i = u.planets.length;
    const rng = makeRng(u.seed + 900 + i);
    u.planets.push({
      orbit: 0.08 + i * 0.035,
      angle: rng() * Math.PI * 2,
      speed: 0.12 + rng() * 0.2,
      r: 2.5 + rng() * 2,
      color: i % 2 === 0 ? u.palette.a : u.palette.b,
      phase: 0,
    });
  }

  // Nebulae
  while (u.nebulae.length < (snap.imageCount || 0)) {
    const rng = makeRng(u.seed + 500 + u.nebulae.length);
    const ang = rng() * Math.PI * 2;
    const dist = 0.12 + rng() * 0.3;
    const i = u.nebulae.length;
    u.nebulae.push({
      x: 0.5 + Math.cos(ang) * dist,
      y: 0.48 + Math.sin(ang) * dist * 0.8,
      r: 40 + rng() * 70,
      color: i % 3 === 0 ? u.palette.a : i % 3 === 1 ? u.palette.b : u.palette.c,
      a: 0.08 + rng() * 0.1,
      rot: 0,
      bloom: 1,
    });
  }

  // Lines for sent
  while (u.lines.filter((l) => l.locked).length < (snap.spellsSent || 0)) {
    lockLine(u);
  }

  const stage = universeStage(snap.intelCount, snap.spellsSent, snap.aligned);
  if (stage.id !== u.stage) {
    u.stage = stage.id;
    u.stageName = stage.name;
    stageFlash = 1;
  }
  u.starCount = u.staticStars.length + u.stars.length + (u.sun ? 1 : 0);
}

function checkStageFlash(u) {
  if (!u) return;
  if (u.stage !== lastStageId && lastStageId >= 0) {
    stageFlash = 1;
  }
  lastStageId = u.stage;
}

function spawnStars(u, n, spiral) {
  const rng = makeRng(u.seed + u.stars.length * 997 + Date.now() % 1000);
  for (let k = 0; k < n; k++) {
    if (u.stars.length >= MAX_ANIM_STARS) {
      const old = u.stars.shift();
      if (old) {
        u.staticStars.push({
          x: old.x,
          y: old.y,
          r: Math.max(0.5, old.r * 0.6),
          a: (old.a || 0.4) * 0.45,
          tw: 0,
          layer: 1,
        });
      }
    }
    const i = u.stars.length;
    let x, y;
    if (spiral) {
      const ang = (Math.PI * 2 * k) / Math.max(1, n) - Math.PI / 2;
      const dist = 0.1 + k * 0.02;
      x = 0.5 + Math.cos(ang) * dist;
      y = 0.48 + Math.sin(ang) * dist * 0.85;
    } else {
      const ang = rng() * Math.PI * 2;
      const dist = 0.08 + rng() * 0.4;
      x = 0.5 + Math.cos(ang) * dist;
      y = 0.48 + Math.sin(ang) * dist * 0.75;
    }
    u.stars.push({
      x,
      y,
      r: 1.2 + rng() * 1.6,
      a: 0.55 + rng() * 0.4,
      hue: rng(),
      tw: rng() * Math.PI * 2,
      spawn: 1, // animate in
      layer: 2,
    });
  }
  u.starCount = u.staticStars.length + u.stars.length + (u.sun ? 1 : 0);
}

function lockLine(u) {
  if (u.stars.length < 2) return;
  const rng = makeRng(u.seed + u.lines.length * 333);
  const i = Math.floor(rng() * u.stars.length);
  const j = Math.floor(rng() * u.stars.length);
  if (i === j) return;
  const a = u.stars[i];
  const b = u.stars[j];
  u.lines.push({
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    a: 0.28,
    locked: true,
  });
}

/** Live events */
export function universeEvent(type, payload = {}) {
  if (!uni) return { starsAdded: 0 };
  const u = uni;
  let starsAdded = 0;

  switch (type) {
    case "intel": {
      const n = payload.count || 1;
      spawnStars(u, 6 * n, false);
      starsAdded = 6 * n;
      u.intelCount = (u.intelCount || 0) + n;
      break;
    }
    case "align": {
      if (!u.sun) {
        u.sun = { x: 0.5, y: 0.48, r: 6, ignition: 1, pulse: 0 };
      } else {
        u.sun.ignition = 1;
      }
      u.aligned = true;
      spawnStars(u, 6, true);
      starsAdded = 6;
      // planets from directives
      const dirs = payload.directives || 0;
      while (u.planets.length < Math.min(8, dirs)) {
        const i = u.planets.length;
        u.planets.push({
          orbit: 0.08 + i * 0.035,
          angle: Math.random() * Math.PI * 2,
          speed: 0.12 + Math.random() * 0.2,
          r: 2.5 + Math.random() * 2,
          color: i % 2 === 0 ? u.palette.a : u.palette.b,
          phase: 0,
        });
      }
      stageFlash = 1;
      break;
    }
    case "image": {
      const n = payload.count || 1;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 0.12 + Math.random() * 0.3;
        u.nebulae.push({
          x: 0.5 + Math.cos(ang) * dist,
          y: 0.48 + Math.sin(ang) * dist * 0.8,
          r: 40 + Math.random() * 70,
          color:
            i % 3 === 0 ? u.palette.a : i % 3 === 1 ? u.palette.b : u.palette.c,
          a: 0.1,
          rot: 0,
          bloom: 1,
        });
      }
      u.imageCount = (u.imageCount || 0) + n;
      break;
    }
    case "spell": {
      // Comet streak
      const ang = Math.random() * Math.PI * 2;
      u.comets.push({
        x1: 0.5 + Math.cos(ang) * 0.55,
        y1: 0.48 + Math.sin(ang) * 0.4,
        x2: 0.5 - Math.cos(ang) * 0.2,
        y2: 0.48 - Math.sin(ang) * 0.15,
        t: 0,
        dur: 0.9 + Math.random() * 0.4,
      });
      spawnStars(u, 2, false);
      starsAdded = 2;
      break;
    }
    case "sent": {
      lockLine(u);
      break;
    }
    case "pulse": {
      if (u.sun) {
        u.ripples.push({ r: 0.02, a: 0.7 });
      } else {
        u.ripples.push({ r: 0.02, a: 0.5 });
        // center ripple even without sun
        if (!u.sun) {
          u._pulseOrigin = { x: 0.5, y: 0.48 };
        }
      }
      spawnStars(u, 1, false);
      starsAdded = 1;
      break;
    }
    default:
      break;
  }

  const stage = universeStage(
    u.intelCount,
    payload.spellsSent != null ? payload.spellsSent : u.lines.filter((l) => l.locked).length,
    u.aligned
  );
  if (stage.id !== u.stage) {
    u.stage = stage.id;
    u.stageName = stage.name;
    stageFlash = 1;
  }
  emitHud();
  return { starsAdded, stageName: u.stageName, starCount: u.starCount };
}

function emitHud() {
  if (!onHud || !uni) {
    if (onHud && !uni) onHud({ starCount: 0, stageName: "VOID", stage: 0, name: "" });
    return;
  }
  onHud({
    starCount: uni.starCount,
    stageName: uni.stageName,
    stage: uni.stage,
    name: uni.name,
    signal: uni.signal,
    aligned: uni.aligned,
  });
}

export function getUniverseHud() {
  if (!uni) return { starCount: 0, stageName: "VOID", stage: 0 };
  return {
    starCount: uni.starCount,
    stageName: uni.stageName,
    stage: uni.stage,
    name: uni.name,
  };
}

export function destroyUniverse() {
  stopLoop();
  uni = null;
  canvas = null;
  ctx = null;
}
