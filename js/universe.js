/**
 * Grimoire Universe Engine — each Focus is its own cosmos.
 * Canvas-only, deterministic from focus state, rAF + performance caps.
 * Outer-space starfield fills as vault intelligence densens over time.
 * No DOM stars. No libraries.
 */

const MAX_ANIM_STARS = 480;
const MAX_DEEP_FIELD = 220;
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
 * Temporal densen 0–1: vault intel + casts + age since Focus creation.
 * Stars fill the sky as this rises (outer space around the operator).
 */
export function computeDensenProgress({
  intelCount = 0,
  spellsSent = 0,
  spellsTotal = 0,
  directives = 0,
  aligned = false,
  ageMs = 0,
  vaultBits = 0,
  imageCount = 0,
} = {}) {
  const ageDays = Math.max(0, ageMs) / 86400000;
  // Existence alone slowly seeds the void (full over ~21 days)
  const ageFactor = Math.min(1, ageDays / 21);
  const intelFactor = Math.min(1, intelCount / 36);
  const castFactor = Math.min(1, spellsSent / 14);
  const craftFactor = Math.min(1, spellsTotal / 20);
  const dirFactor = Math.min(1, directives / 8);
  const vaultFactor = Math.min(1, vaultBits / 24);
  const imageFactor = Math.min(1, imageCount / 8);
  const alignBoost = aligned ? 0.12 : 0;
  const raw =
    alignBoost +
    intelFactor * 0.32 +
    castFactor * 0.16 +
    craftFactor * 0.1 +
    dirFactor * 0.08 +
    vaultFactor * 0.1 +
    imageFactor * 0.04 +
    ageFactor * 0.18;
  return Math.max(0, Math.min(1, raw));
}

function resolveFocusCreatedAt(convo) {
  if (!convo) return Date.now();
  if (convo.createdAt) return Number(convo.createdAt);
  const msgs = convo.messages || [];
  let minTs = 0;
  for (const m of msgs) {
    const t = Number(m.ts || m.createdAt || 0);
    if (t && (!minTs || t < minTs)) minTs = t;
  }
  return minTs || Date.now();
}

/**
 * Count intel bits from convo messages + temporal densen (deterministic).
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
      createdAt: 0,
      ageMs: 0,
      vaultBits: 0,
      densenProgress: 0,
    };
  }
  const msgs = convo.messages || [];
  let intelCount = 0;
  let imageCount = 0;
  let vaultBits = 0;
  for (const m of msgs) {
    if (m.role === "user") {
      intelCount += 1;
      vaultBits += 1;
      if (Array.isArray(m.images)) imageCount += m.images.length;
      const len = String(m.text || "").trim().length;
      if (len > 80) vaultBits += 1;
      if (len > 400) vaultBits += 1;
    } else if (m.role === "grimoire") {
      vaultBits += 0.25;
    }
  }
  if (convo.alignmentReceived || convo.alignmentRevealed || convo.alignmentNotes) {
    intelCount = Math.max(intelCount, 1);
    vaultBits += 2;
    const noteLen = String(convo.alignmentNotes || "").length;
    vaultBits += Math.min(6, Math.floor(noteLen / 200));
  }
  const focusSpells = (spells || []).filter((s) => s.conversationId === convo.id);
  const spellsSent = focusSpells.filter((s) => s.status === "sent").length;
  const spellsReady = focusSpells.filter((s) => s.status !== "sent").length;
  vaultBits += focusSpells.length;
  const dirs = convo.alignmentProfile?.directives?.length || 0;
  const signal =
    convo.alignmentProfile?.signal != null
      ? Number(convo.alignmentProfile.signal)
      : 5;
  const aligned = Boolean(
    convo.alignmentRevealed || convo.alignmentReceived || convo.alignmentNotes
  );
  const createdAt = resolveFocusCreatedAt(convo);
  // Persist birth time so temporal densen is stable across sessions
  if (!convo.createdAt) convo.createdAt = createdAt;
  const ageMs = Math.max(0, Date.now() - createdAt);
  const densenProgress = computeDensenProgress({
    intelCount,
    spellsSent,
    spellsTotal: focusSpells.length,
    directives: dirs,
    aligned,
    ageMs,
    vaultBits,
    imageCount,
  });

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
    createdAt,
    ageMs,
    vaultBits: Math.floor(vaultBits),
    densenProgress,
  };
}

/** Deep-field + intel star targets — sky fills with densen / age / vault. */
function starFieldTargets(snapshot) {
  const densen = snapshot.densenProgress || 0;
  const ageMs = snapshot.ageMs || 0;
  // +1 deep star every ~4h of Focus life, soft-capped
  const ageBoost = Math.min(90, Math.floor(ageMs / (4 * 3600000)));
  const deepField = Math.min(
    MAX_DEEP_FIELD,
    Math.floor(24 + densen * 160 + ageBoost * 0.55 + (snapshot.intelCount || 0) * 1.2)
  );
  const intelStars = Math.min(
    MAX_ANIM_STARS,
    Math.floor(
      12 +
        densen * 140 +
        (snapshot.intelCount || 0) * 7 +
        (snapshot.spellsTotal || 0) * 2.5 +
        (snapshot.spellsSent || 0) * 2 +
        ageBoost * 0.35
    )
  );
  // Fraction of intel stars that scatter full-sky (outer space) vs nucleus orbit
  const fieldMix = 0.25 + densen * 0.55;
  return { deepField, intelStars, fieldMix, densen };
}

function formatAgeShort(ageMs) {
  if (!ageMs || ageMs < 60000) return "new";
  const m = Math.floor(ageMs / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
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
  const targets = starFieldTargets(snapshot);
  const densen = targets.densen;

  // Distant dust (parallax layer 0) — densens with vault
  const dust = [];
  const dustN = Math.floor(60 + densen * 100);
  for (let i = 0; i < dustN; i++) {
    dust.push({
      x: rng(),
      y: rng(),
      r: 0.25 + rng() * 1.3,
      a: 0.03 + rng() * (0.06 + densen * 0.06),
      layer: 0,
    });
  }

  // Deep-field stars — full-sky outer space (grows with densen + age)
  const staticStars = [];
  for (let i = 0; i < targets.deepField; i++) {
    // Slight edge bias so center stays for nucleus / sun
    const edge = rng() > 0.35;
    let x = rng();
    let y = rng();
    if (!edge) {
      const ang = rng() * Math.PI * 2;
      const dist = 0.15 + rng() * 0.45;
      x = 0.5 + Math.cos(ang) * dist;
      y = 0.48 + Math.sin(ang) * dist * 0.78;
      x = Math.max(0.02, Math.min(0.98, x));
      y = Math.max(0.02, Math.min(0.98, y));
    }
    staticStars.push({
      x,
      y,
      r: 0.45 + rng() * (0.9 + densen * 0.6),
      a: 0.12 + rng() * (0.22 + densen * 0.2),
      tw: rng() * Math.PI * 2,
      layer: 1,
      // Gradual reveal index — tick fades them in by densen
      birth: i / Math.max(1, targets.deepField),
    });
  }

  // Intel stars — mix of nucleus orbit + full-sky field fill
  const stars = [];
  // On first paint, seed a fraction immediately; rest fill via tick (gradual)
  const seedCount = Math.min(
    targets.intelStars,
    Math.max(8, Math.floor(targets.intelStars * (0.35 + densen * 0.25)))
  );
  for (let i = 0; i < seedCount; i++) {
    stars.push(makeIntelStar(rng, i, targets.fieldMix, densen, i === seedCount - 1 ? 0.2 : 0));
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
    // Temporal densen state
    createdAt: snapshot.createdAt || 0,
    ageMs: snapshot.ageMs || 0,
    vaultBits: snapshot.vaultBits || 0,
    densenProgress: densen * 0.55, // start mid-chase so stars fill in on screen
    targetDensen: densen,
    starTarget: targets.intelStars,
    deepFieldTarget: targets.deepField,
    fieldMix: targets.fieldMix,
    _spellsTotal: snapshot.spellsTotal || 0,
    _spellsSent: snapshot.spellsSent || 0,
    // Live fill progress 0–1 toward current starTarget (gradual materialize)
    fillT: seedCount / Math.max(1, targets.intelStars),
    starCount: staticStars.length + stars.length + (sun ? 1 : 0),
  };
}

/** One intel star: nucleus-orbit or full-sky field (outer space). */
function makeIntelStar(rng, index, fieldMix, densen, spawn = 1) {
  const fullField = rng() < fieldMix;
  let x;
  let y;
  if (fullField) {
    x = rng();
    y = rng();
  } else {
    const ang = rng() * Math.PI * 2;
    const dist = 0.06 + rng() * (0.28 + densen * 0.22);
    x = 0.5 + Math.cos(ang) * dist * (0.75 + rng() * 0.45);
    y = 0.48 + Math.sin(ang) * dist * 0.72;
    x = Math.max(0.02, Math.min(0.98, x));
    y = Math.max(0.02, Math.min(0.98, y));
  }
  return {
    x,
    y,
    r: (fullField ? 0.7 : 1.1) + rng() * (1.2 + densen * 0.8),
    a: 0.4 + rng() * (0.4 + densen * 0.15),
    hue: rng(),
    tw: rng() * Math.PI * 2,
    spawn,
    layer: 2,
    field: fullField,
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
  // Live age / temporal densen — sky keeps filling as Focus lives
  if (u.createdAt) {
    u.ageMs = Math.max(0, Date.now() - u.createdAt);
  }
  // Soft age floor: existence alone slowly seeds the void
  const ageDays = (u.ageMs || 0) / 86400000;
  const ageFloor = Math.min(0.18, (ageDays / 21) * 0.18);
  if ((u.targetDensen || 0) < ageFloor) u.targetDensen = ageFloor;

  // Soft-chase densen (smooth visual fill)
  if (u.densenProgress == null) u.densenProgress = 0;
  if (u.densenProgress < (u.targetDensen || 0)) {
    u.densenProgress = Math.min(u.targetDensen, u.densenProgress + dt * 0.12);
  } else if (u.densenProgress > (u.targetDensen || 0)) {
    u.densenProgress = u.targetDensen || 0;
  }

  const liveTargets = starFieldTargets({
    densenProgress: u.densenProgress || 0,
    ageMs: u.ageMs || 0,
    intelCount: u.intelCount || 0,
    spellsTotal: u._spellsTotal || 0,
    spellsSent:
      u._spellsSent != null
        ? u._spellsSent
        : u.lines?.filter((l) => l.locked).length || 0,
  });
  u.starTarget = liveTargets.intelStars;
  u.deepFieldTarget = liveTargets.deepField;
  u.fieldMix = liveTargets.fieldMix;

  // Gradual intel-star materialize toward target
  const starNeed = (u.starTarget || 0) - u.stars.length;
  if (starNeed > 0) {
    // Fill rate: faster when densen is high / when far behind
    const rate = 2 + u.densenProgress * 10 + Math.min(8, starNeed * 0.15);
    u._fillAcc = (u._fillAcc || 0) + dt * rate;
    while (u._fillAcc >= 1 && u.stars.length < u.starTarget) {
      u._fillAcc -= 1;
      const rng = makeRng(u.seed + u.stars.length * 997 + Math.floor(u.time * 10));
      u.stars.push(
        makeIntelStar(rng, u.stars.length, u.fieldMix || 0.4, u.densenProgress || 0, 1)
      );
    }
  }
  u.fillT = u.starTarget > 0 ? Math.min(1, u.stars.length / u.starTarget) : 1;

  // Deep field grows slowly with age/densen
  while (u.staticStars.length < (u.deepFieldTarget || 0) && u.staticStars.length < MAX_DEEP_FIELD) {
    const rng = makeRng(u.seed + 44000 + u.staticStars.length * 13);
    u.staticStars.push({
      x: rng(),
      y: rng(),
      r: 0.4 + rng() * 1.1,
      a: 0.1 + rng() * 0.28,
      tw: rng() * Math.PI * 2,
      layer: 1,
      birth: u.staticStars.length / Math.max(1, u.deepFieldTarget),
      spawn: 1,
    });
  }
  for (const s of u.staticStars) {
    if (s.spawn > 0) s.spawn = Math.max(0, s.spawn - dt / 1.2);
  }

  for (const p of u.planets) {
    p.angle += p.speed * dt;
  }
  for (const s of u.stars) {
    if (s.spawn > 0) s.spawn = Math.max(0, s.spawn - dt / 0.7);
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

  // Temporal HUD pulse (age / densen % without new UI chrome)
  u._hudAcc = (u._hudAcc || 0) + dt;
  if (u._hudAcc > 1.2) {
    u._hudAcc = 0;
    emitHud();
  }
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

  const densenB = uni?.densenProgress != null ? uni.densenProgress : 0;
  const brightness = uni
    ? 0.5 + (uni.signal / 10) * 0.45 + densenB * 0.2
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

  // Deep-field outer space — full-sky stars, revealed by densen/age
  ctx.save();
  ctx.translate(px * 0.45, py * 0.45);
  const densenVis = u.densenProgress != null ? u.densenProgress : 0;
  for (const s of u.staticStars) {
    // birth threshold: denser cosmos reveals farther stars
    const birth = s.birth != null ? s.birth : 0;
    if (birth > densenVis + 0.08 && densenVis < 0.95) continue;
    const reveal =
      s.spawn > 0 ? 1 - s.spawn : birth <= densenVis ? 1 : Math.max(0, 1 - (birth - densenVis) * 8);
    if (reveal <= 0.02) continue;
    const tw = 0.65 + 0.35 * Math.sin(u.time * 1.15 + s.tw);
    const a = s.a * tw * brightness * reveal * (0.55 + densenVis * 0.55);
    ctx.beginPath();
    ctx.fillStyle = `rgba(220,225,255,${a})`;
    ctx.arc(s.x * w, s.y * h, s.r * (0.85 + densenVis * 0.25), 0, Math.PI * 2);
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
  u.createdAt = snap.createdAt || u.createdAt || 0;
  u.ageMs = snap.ageMs != null ? snap.ageMs : u.ageMs;
  u.vaultBits = snap.vaultBits || 0;
  u._spellsTotal = snap.spellsTotal || 0;
  u._spellsSent = snap.spellsSent || 0;
  // Target densen rises with vault; visual fill chases in tick
  u.targetDensen = snap.densenProgress != null ? snap.densenProgress : u.targetDensen || 0;
  if (u.densenProgress == null) u.densenProgress = u.targetDensen;

  const targets = starFieldTargets(snap);
  u.starTarget = targets.intelStars;
  u.deepFieldTarget = targets.deepField;
  u.fieldMix = targets.fieldMix;

  if (snap.aligned && !wasAligned) {
    u.sun = { x: 0.5, y: 0.48, r: 6, ignition: 1, pulse: 0 };
    spawnStars(u, 8, true);
  } else if (snap.aligned && !u.sun) {
    u.sun = { x: 0.5, y: 0.48, r: 6, ignition: 0, pulse: 0 };
  }

  // Immediate burst only when far behind (intel jump) — rest fills gradually in tick
  const gap = targets.intelStars - u.stars.length;
  if (gap > 24) {
    spawnStars(u, Math.min(18, Math.floor(gap * 0.35)), false);
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
  const densen = u.densenProgress || 0;
  const fieldMix = spiral ? 0.1 : u.fieldMix != null ? u.fieldMix : 0.4;
  const rng = makeRng(u.seed + u.stars.length * 997 + (Date.now() % 1000));
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
          birth: densen,
          spawn: 0,
        });
        if (u.staticStars.length > MAX_DEEP_FIELD) {
          u.staticStars.splice(0, u.staticStars.length - MAX_DEEP_FIELD);
        }
      }
    }
    if (spiral) {
      const ang = (Math.PI * 2 * k) / Math.max(1, n) - Math.PI / 2;
      const dist = 0.1 + k * 0.02;
      u.stars.push({
        x: 0.5 + Math.cos(ang) * dist,
        y: 0.48 + Math.sin(ang) * dist * 0.85,
        r: 1.2 + rng() * 1.6,
        a: 0.55 + rng() * 0.4,
        hue: rng(),
        tw: rng() * Math.PI * 2,
        spawn: 1,
        layer: 2,
        field: false,
      });
    } else {
      u.stars.push(makeIntelStar(rng, u.stars.length, fieldMix, densen, 1));
    }
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
    if (onHud && !uni) {
      onHud({
        starCount: 0,
        stageName: "VOID",
        stage: 0,
        name: "",
        densenProgress: 0,
        ageMs: 0,
        ageLabel: "",
      });
    }
    return;
  }
  onHud({
    starCount: uni.starCount,
    stageName: uni.stageName,
    stage: uni.stage,
    name: uni.name,
    signal: uni.signal,
    aligned: uni.aligned,
    densenProgress: uni.densenProgress || 0,
    ageMs: uni.ageMs || 0,
    ageLabel: formatAgeShort(uni.ageMs || 0),
    fillT: uni.fillT || 0,
  });
}

export function getUniverseHud() {
  if (!uni) {
    return {
      starCount: 0,
      stageName: "VOID",
      stage: 0,
      densenProgress: 0,
      ageMs: 0,
      ageLabel: "",
    };
  }
  return {
    starCount: uni.starCount,
    stageName: uni.stageName,
    stage: uni.stage,
    name: uni.name,
    densenProgress: uni.densenProgress || 0,
    ageMs: uni.ageMs || 0,
    ageLabel: formatAgeShort(uni.ageMs || 0),
    fillT: uni.fillT || 0,
    vaultBits: uni.vaultBits || 0,
  };
}

export function destroyUniverse() {
  stopLoop();
  uni = null;
  canvas = null;
  ctx = null;
}
