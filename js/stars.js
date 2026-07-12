/**
 * Living constellation — grows forever, never shrinks.
 *
 * - Base: 40 faint static stars (always present)
 * - Alignment: bright central hub (6px, opacity 0.9) + radial glow
 * - Each intelligence capture: +6 stars near center, faint lines to hub
 * - Stars only add — no hard cap
 */

const BASE_STAR_COUNT = 40;
const STARS_PER_INTEL = 6;
const COLORS = ["#ffffff", "#e8eeff", "#c8d8ff", "#b8ccff", "#dce6ff"];

/**
 * @typedef {Object} FocusMetrics
 * @property {number} spellCount
 * @property {boolean} alignmentRevealed
 * @property {number} [entitiesMentioned]
 * @property {number} [intelBits]
 * @property {string[]} [spellTypes]
 * @property {number} [lastActive]
 * @property {string} [type]
 * @property {string} [name]
 */

/** @type {Record<string, FocusMetrics>} */
export const focusState = {};

/**
 * Per-focus accumulated geometry (never shrinks).
 * @type {Record<string, {
 *   hub: boolean,
 *   intelStars: Array<{x:number,y:number,kind:string}>,
 *   lineCount: number,
 *   pulseLines: number,
 *   name?: string
 * }>}
 */
const growth = {};

let _bound = null;
let _basePainted = false;
/** @type {string|null} */
let _paintedFocusId = null;

function emptyMetrics() {
  return {
    spellCount: 0,
    alignmentRevealed: false,
    entitiesMentioned: 0,
    intelBits: 0,
    spellTypes: [],
    lastActive: 0,
  };
}

function ensureGrowth(focusId) {
  if (!growth[focusId]) {
    growth[focusId] = {
      hub: false,
      intelStars: [],
      lineCount: 0,
      pulseLines: 0,
      name: "",
      flareUntil: 0,
    };
  }
  if (growth[focusId].pulseLines == null) growth[focusId].pulseLines = 0;
  return growth[focusId];
}

function pushIntelStar(g, focusId, index, opts = {}) {
  const seedBase = hashSeed(g.name || focusId);
  const i = index;
  const t = seeded(seedBase + i * 97 + 3);
  const ang =
    opts.spiral != null
      ? opts.spiral
      : t * Math.PI * 2;
  const ring =
    opts.ring != null
      ? opts.ring
      : 8 + (i % 5) * 4 + seeded(seedBase + i * 13) * 8;
  const cx = 50;
  const cy = 48;
  const star = {
    x: clamp(cx + Math.cos(ang) * ring, 6, 94),
    y: clamp(cy + Math.sin(ang) * ring * 0.88, 6, 94),
    kind: opts.kind || (i % 5 === 0 ? "person" : i % 3 === 0 ? "ai" : "spell"),
    spawnUntil: Date.now() + 700,
    lineSpawn: true,
  };
  g.intelStars.push(star);
  return star;
}

export function setFocusMetrics(focusId, metrics = {}) {
  if (!focusId) return;
  const prev = focusState[focusId] || emptyMetrics();
  // Never let intelBits / alignment go backwards
  const nextBits = Math.max(
    prev.intelBits || 0,
    metrics.intelBits || 0,
    metrics.entitiesMentioned || 0
  );
  const nextAlign =
    Boolean(prev.alignmentRevealed) || Boolean(metrics.alignmentRevealed);
  const nextSpells = Math.max(prev.spellCount || 0, metrics.spellCount || 0);

  focusState[focusId] = {
    ...prev,
    ...metrics,
    spellCount: nextSpells,
    alignmentRevealed: nextAlign,
    intelBits: nextBits,
    entitiesMentioned: Math.max(
      prev.entitiesMentioned || 0,
      metrics.entitiesMentioned || 0,
      nextBits
    ),
    spellTypes: metrics.spellTypes || prev.spellTypes || [],
    lastActive: metrics.lastActive || Date.now(),
  };

  syncGrowthFromMetrics(focusId);
}

/**
 * Grow geometry from metrics — only adds, never removes.
 */
function syncGrowthFromMetrics(focusId) {
  const m = focusState[focusId] || emptyMetrics();
  const g = ensureGrowth(focusId);
  if (m.name) g.name = m.name;

  if (m.alignmentRevealed) g.hub = true;

  // Target intel star count: 6 per capture bit + 2 per spell
  const bits = m.intelBits || m.entitiesMentioned || 0;
  const fromBits = bits * STARS_PER_INTEL;
  const fromSpells = (m.spellCount || 0) * 2;
  const target = fromBits + fromSpells;

  while (g.intelStars.length < target) {
    pushIntelStar(g, focusId, g.intelStars.length);
  }

  g.lineCount = Math.max(
    g.lineCount,
    Math.floor(g.intelStars.length / 2) +
      (g.hub ? 6 : 0) +
      (g.pulseLines || 0)
  );
}

/**
 * Visible live growth — +6 stars per capture with spawn animation metadata.
 * Alignment lock: hub flare + 6 spiral stars.
 * Returns { starsAdded, alignmentLock } for activity ping.
 */
export function liveCapture(focusId, { captures = 1, alignmentLock = false } = {}) {
  if (!focusId) return { starsAdded: 0, alignmentLock: false };
  const g = ensureGrowth(focusId);
  const before = g.intelStars.length;
  const n = Math.max(1, captures | 0);

  if (alignmentLock) {
    g.hub = true;
    g.flareUntil = Date.now() + 1100;
  }

  const prev = focusState[focusId] || emptyMetrics();
  setFocusMetrics(focusId, {
    ...prev,
    intelBits: (prev.intelBits || 0) + n,
    entitiesMentioned: (prev.entitiesMentioned || 0) + n,
    alignmentRevealed:
      Boolean(prev.alignmentRevealed) || alignmentLock || g.hub,
  });

  // Ensure at least STARS_PER_INTEL * n new stars this capture
  const want = before + STARS_PER_INTEL * n;
  while (g.intelStars.length < want) {
    const i = g.intelStars.length;
    if (alignmentLock && i < before + 6) {
      // Spiral in around hub
      const k = i - before;
      const ang = (Math.PI * 2 * k) / 6 - Math.PI / 2 + k * 0.15;
      pushIntelStar(g, focusId, i, {
        spiral: ang,
        ring: 10 + k * 1.5,
        kind: "spell",
      });
    } else {
      pushIntelStar(g, focusId, i);
    }
  }

  // Pulse lines grow with densify formula
  const bits = (focusState[focusId]?.intelBits || 0);
  const target =
    bits * STARS_PER_INTEL + ((focusState[focusId]?.spellCount || 0) * 2);
  g.pulseLines =
    (g.pulseLines || 0) +
    Math.max(0, target - (g.intelStars.length - 1));
  g.lineCount = Math.max(
    g.lineCount,
    Math.floor(g.intelStars.length / 2) +
      (g.hub ? 6 : 0) +
      (g.pulseLines || 0)
  );

  const starsAdded = g.intelStars.length - before;
  if (_bound) redrawBound();
  return { starsAdded, alignmentLock: Boolean(alignmentLock) };
}

/**
 * densenConstellationFromIntel — grow lines for this Focus only.
 * Pulse Protocol: g.pulseLines += max(0, target - (g.intelStars.length - 1))
 * Never shrinks; never touches other Focuses.
 */
export function densenConstellationFromIntel(focusId) {
  if (!focusId) return;
  syncGrowthFromMetrics(focusId);
  const m = focusState[focusId] || emptyMetrics();
  const g = ensureGrowth(focusId);

  const bits = m.intelBits || m.entitiesMentioned || 0;
  const fromBits = bits * STARS_PER_INTEL;
  const fromSpells = (m.spellCount || 0) * 2;
  const target = fromBits + fromSpells;

  // Extra constellation lines per densify / pulse (Focus-local only)
  g.pulseLines =
    (g.pulseLines || 0) +
    Math.max(0, target - (g.intelStars.length - 1));

  g.lineCount = Math.max(
    g.lineCount,
    Math.floor(g.intelStars.length / 2) +
      (g.hub ? 6 : 0) +
      (g.pulseLines || 0)
  );

  if (_bound) redrawBound();
}

/**
 * Primary API — call after intelligence / spells / focus switch.
 * @param {string} focusId
 * @param {number|string} spellCountOrType
 * @param {boolean|object} [hasAlignmentOrPatch]
 */
export function updateConstellation(focusId, spellCountOrType, hasAlignmentOrPatch) {
  if (!focusId) return;

  const prev = focusState[focusId] || emptyMetrics();
  let spellCount = prev.spellCount || 0;
  let alignmentRevealed = prev.alignmentRevealed || false;
  let patch = {};

  if (typeof spellCountOrType === "number") {
    spellCount = Math.max(spellCount, spellCountOrType);
    if (typeof hasAlignmentOrPatch === "boolean") {
      alignmentRevealed = alignmentRevealed || hasAlignmentOrPatch;
    } else if (hasAlignmentOrPatch && typeof hasAlignmentOrPatch === "object") {
      patch = hasAlignmentOrPatch;
      if (typeof patch.spellCount === "number") {
        spellCount = Math.max(spellCount, patch.spellCount);
      }
      if (patch.alignmentRevealed === true) alignmentRevealed = true;
    }
  } else {
    // Legacy: updateConstellation(id, spellType, patch)
    const spellType = spellCountOrType;
    patch =
      hasAlignmentOrPatch && typeof hasAlignmentOrPatch === "object"
        ? hasAlignmentOrPatch
        : {};
    spellCount =
      typeof patch.spellCount === "number"
        ? Math.max(spellCount, patch.spellCount)
        : spellCount + 1;
    alignmentRevealed =
      alignmentRevealed ||
      spellType === "reveal" ||
      patch.alignmentRevealed === true;
  }

  // Merge intelBits only upward
  const intelBits = Math.max(
    prev.intelBits || 0,
    patch.intelBits || 0,
    patch.entitiesMentioned || 0
  );

  setFocusMetrics(focusId, {
    ...prev,
    ...patch,
    spellCount,
    alignmentRevealed,
    intelBits,
    lastActive: Date.now(),
  });

  if (_bound) redrawBound();
}

/**
 * Explicit: one intelligence capture → +6 stars (and grow forever).
 */
export function captureIntelligenceStars(focusId, captures = 1) {
  return liveCapture(focusId, { captures, alignmentLock: false });
}

function redrawBound() {
  if (!_bound) return;
  const ctx =
    typeof _bound.getContext === "function" ? _bound.getContext() : _bound;
  renderFullConstellation(ctx);
}

function snapshotMetrics() {
  const out = {};
  for (const [id, m] of Object.entries(focusState)) out[id] = { ...m };
  return out;
}

/**
 * Full paint. Base stars stay; focus intel only grows (repaint on focus switch
 * rebuilds from growth memory — never smaller than last known for that focus).
 */
export function renderFullConstellation({
  container,
  svg,
  conversations,
  activeId,
  onSelect,
  metricsById = {},
}) {
  _bound = {
    getContext: () => ({
      container,
      svg,
      conversations,
      activeId,
      onSelect,
      metricsById: { ...metricsById, ...snapshotMetrics() },
    }),
  };

  for (const [id, m] of Object.entries(metricsById)) {
    setFocusMetrics(id, m);
  }
  if (activeId) syncGrowthFromMetrics(activeId);

  // Focus switch: clear only focus-layer nodes, never shrink growth[] memory
  const focusChanged = _paintedFocusId !== activeId;
  if (focusChanged) {
    container
      .querySelectorAll(".star.intel, .star.node, .star-hub-glow")
      .forEach((el) => el.remove());
    svg.innerHTML = "";
    _paintedFocusId = activeId;
  } else {
    // Same focus: remove only nodes/lines to re-layer links; keep ambient
    container
      .querySelectorAll(".star.intel, .star.node, .star-hub-glow")
      .forEach((el) => el.remove());
    svg.innerHTML = "";
  }

  // Base 40 faint static stars — paint once, never remove
  ensureBaseStars(container);

  const active = focusState[activeId] || emptyMetrics();
  const g = ensureGrowth(activeId || "_void");
  if (active.name) g.name = active.name;
  if (active.alignmentRevealed) g.hub = true;

  svg.classList.toggle("aligned", Boolean(g.hub));
  svg.style.setProperty(
    "--line-opacity",
    String(0.05 + Math.min(0.25, (g.intelStars.length || 0) * 0.008))
  );

  renderIntelligenceLayer(container, svg, g);
  renderFocusNodes(container, svg, conversations, activeId, onSelect, metricsById);
}

/**
 * 40 faint static ambient stars — created once, never removed.
 */
function ensureBaseStars(container) {
  if (_basePainted && container.querySelectorAll(".star.ambient").length >= BASE_STAR_COUNT) {
    return;
  }
  // Only strip ambient if count is wrong; then rebuild once
  container.querySelectorAll(".star.ambient").forEach((el) => el.remove());
  const frag = document.createDocumentFragment();
  for (let i = 0; i < BASE_STAR_COUNT; i++) {
    const s = document.createElement("div");
    const t = seeded(1000 + i * 17);
    s.className = "star ambient";
    s.style.setProperty("--size", `${t < 0.4 ? 0.9 : t < 0.75 ? 1.15 : 1.4}px`);
    s.style.setProperty("--star-color", COLORS[i % COLORS.length]);
    s.style.left = `${seeded(2000 + i * 31) * 100}%`;
    s.style.top = `${seeded(3000 + i * 47) * 100}%`;
    s.style.setProperty("--duration", `${5 + seeded(4000 + i) * 5}s`);
    s.style.setProperty("--delay", `${seeded(5000 + i) * 8}s`);
    // Faint static field
    s.style.setProperty("--base-opacity", String(0.28 + seeded(6000 + i) * 0.22));
    frag.appendChild(s);
  }
  container.appendChild(frag);
  _basePainted = true;
}

/**
 * Hub + intel stars + lines for active focus (from growth memory).
 * Fresh stars get spawn-in animation; hub gets flare on alignment lock.
 */
function renderIntelligenceLayer(container, svg, g) {
  if (!g) return;
  const ns = "http://www.w3.org/2000/svg";
  const cx = 50;
  const cy = 48;
  const now = Date.now();
  const flaring = g.flareUntil && now < g.flareUntil;
  const points = [];

  // Alignment: bright central anchor (radius 6px, opacity 0.9) + glow
  if (g.hub) {
    points.push({ x: cx, y: cy, kind: "hub", flaring });
    const glow = document.createElement("div");
    glow.className = "star-hub-glow" + (flaring ? " flare" : "");
    glow.style.left = `${cx}%`;
    glow.style.top = `${cy}%`;
    glow.setAttribute("aria-hidden", "true");
    container.appendChild(glow);

    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI * 2 * i) / 6 - Math.PI / 2;
      const dist = 14 + (i % 2) * 4;
      points.push({
        x: cx + Math.cos(ang) * dist,
        y: cy + Math.sin(ang) * dist,
        kind: "ray",
        hub: true,
      });
    }
  }

  for (const p of g.intelStars) {
    points.push({ ...p });
  }

  const hub = points.find((p) => p.kind === "hub");

  if (hub) {
    for (const p of points) {
      if (p.hub || p.kind === "ray") {
        appendLine(svg, ns, hub, p, "ray-line", 0.28, false);
      }
    }
  }

  // Lines from each intel star → focus anchor (hub or center)
  const anchor = hub || { x: cx, y: cy };
  for (const p of g.intelStars) {
    const isNew = p.spawnUntil && now < p.spawnUntil;
    appendLine(
      svg,
      ns,
      anchor,
      p,
      "intel-line",
      isNew ? 0.35 : 0.1 + Math.random() * 0.06,
      isNew || p.lineSpawn
    );
    if (p.lineSpawn && !isNew) p.lineSpawn = false;
  }

  const maxLinks = Math.max(
    g.lineCount,
    Math.floor(g.intelStars.length / 2) + (g.pulseLines || 0)
  );
  let links = 0;
  for (let i = 0; i < g.intelStars.length && links < maxLinks + 12; i++) {
    for (let j = i + 1; j < g.intelStars.length && links < maxLinks + 12; j++) {
      const a = g.intelStars[i];
      const b = g.intelStars[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 2 && d < 18) {
        appendLine(svg, ns, a, b, "intel-line", 0.08 + (1 - d / 18) * 0.12, false);
        links++;
      }
    }
  }

  if (hub && (g.pulseLines || 0) > 0) {
    const pulseRayN = Math.min(24, g.pulseLines);
    for (let i = 0; i < pulseRayN; i++) {
      const ang = (Math.PI * 2 * i) / Math.max(6, pulseRayN) + 0.2;
      const dist = 10 + (i % 4) * 3;
      const tip = {
        x: clamp(hub.x + Math.cos(ang) * dist, 4, 96),
        y: clamp(hub.y + Math.sin(ang) * dist * 0.88, 4, 96),
      };
      appendLine(svg, ns, hub, tip, "intel-line", 0.07 + (i % 3) * 0.02, false);
    }
  }

  const frag = document.createDocumentFragment();
  for (const p of points) {
    const el = document.createElement("div");
    const isSpawn =
      p.kind !== "hub" &&
      p.kind !== "ray" &&
      p.spawnUntil &&
      now < p.spawnUntil;
    el.className =
      "star intel kind-" +
      p.kind +
      (g.hub ? " aligned-glow" : "") +
      (isSpawn ? " spawn-in" : "") +
      (p.kind === "hub" && flaring ? " hub-flare" : "");
    const size =
      p.kind === "hub" ? 6 : p.kind === "ray" ? 3.2 : 2 + Math.random() * 1.2;
    el.style.setProperty("--size", `${size}px`);
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}%`;
    el.style.setProperty("--duration", `${3 + Math.random() * 3}s`);
    el.style.setProperty("--delay", isSpawn ? "0s" : `${Math.random() * 2}s`);
    el.style.setProperty(
      "--base-opacity",
      String(p.kind === "hub" ? 0.9 : 0.65 + Math.random() * 0.3)
    );
    frag.appendChild(el);
  }
  container.appendChild(frag);

  // Re-render once after spawn window so classes settle without full reload
  const anyFresh =
    flaring ||
    g.intelStars.some((p) => p.spawnUntil && p.spawnUntil > now);
  if (anyFresh && _bound) {
    clearTimeout(renderIntelligenceLayer._settleT);
    renderIntelligenceLayer._settleT = setTimeout(() => {
      if (_bound) redrawBound();
    }, 750);
  }
}

function appendLine(svg, ns, a, b, cls, opacity, spawnGlow) {
  const line = document.createElementNS(ns, "line");
  line.setAttribute("x1", `${a.x}%`);
  line.setAttribute("y1", `${a.y}%`);
  line.setAttribute("x2", `${b.x}%`);
  line.setAttribute("y2", `${b.y}%`);
  line.classList.add(cls);
  if (spawnGlow) line.classList.add("line-spawn");
  line.style.strokeOpacity = String(opacity);
  svg.appendChild(line);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = (h * 31 + String(str).charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seeded(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function renderFocusNodes(container, svg, conversations, activeId, onSelect, metricsById) {
  const ns = "http://www.w3.org/2000/svg";
  const positions = conversations.map((c) => ({
    id: c.id,
    x: c.star?.x ?? 50,
    y: c.star?.y ?? 50,
  }));

  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < 40) {
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", `${a.x}%`);
        line.setAttribute("y1", `${a.y}%`);
        line.setAttribute("x2", `${b.x}%`);
        line.setAttribute("y2", `${b.y}%`);
        line.classList.add("focus-link");
        const ma = focusState[a.id] || metricsById[a.id];
        const mb = focusState[b.id] || metricsById[b.id];
        const linkD = ((ma?.spellCount || 0) + (mb?.spellCount || 0)) * 0.02;
        line.style.strokeOpacity = String(0.06 + Math.min(0.2, linkD));
        svg.appendChild(line);
      }
    }
  }

  conversations.forEach((c) => {
    const m = focusState[c.id] || metricsById[c.id] || emptyMetrics();
    const spells = m.spellCount || 0;
    const density = Math.min(
      1,
      spells * 0.1 + (m.alignmentRevealed ? 0.25 : 0) + (m.intelBits || 0) * 0.02
    );
    const el = document.createElement("button");
    el.type = "button";
    el.className =
      "star node" +
      (c.id === activeId ? " active" : "") +
      (m.alignmentRevealed ? " revealed" : "") +
      (spells > 0 || (m.intelBits || 0) > 0 ? " has-spells" : "");
    el.style.left = `${c.star?.x ?? 50}%`;
    el.style.top = `${c.star?.y ?? 50}%`;
    el.style.setProperty("--node-scale", String(1 + Math.min(0.7, density * 0.8)));
    el.style.setProperty("--node-glow", String(0.4 + density * 0.55));
    el.dataset.label = c.name;
    el.dataset.id = c.id;
    el.title = `${c.name} · ${spells} spell${spells === 1 ? "" : "s"}${m.alignmentRevealed ? " · aligned" : ""}`;
    el.setAttribute("aria-label", `Open focus: ${c.name}`);
    el.addEventListener("click", () => onSelect(c.id));
    container.appendChild(el);
  });
}

export function renderAmbientStars(container) {
  _basePainted = false;
  ensureBaseStars(container);
}

export function renderNodeStars(container, svg, conversations, activeId, onSelect) {
  renderFullConstellation({
    container,
    svg,
    conversations,
    activeId,
    onSelect,
    metricsById: snapshotMetrics(),
  });
}

export function randomStarPosition(existing) {
  let best = { x: 50, y: 50 };
  let bestMin = -1;
  for (let attempt = 0; attempt < 24; attempt++) {
    const candidate = {
      x: 12 + Math.random() * 76,
      y: 12 + Math.random() * 76,
    };
    let minD = Infinity;
    for (const c of existing) {
      const d = Math.hypot(
        candidate.x - (c.star?.x ?? 50),
        candidate.y - (c.star?.y ?? 50)
      );
      if (d < minD) minD = d;
    }
    if (minD > bestMin) {
      bestMin = minD;
      best = candidate;
    }
  }
  return best;
}
