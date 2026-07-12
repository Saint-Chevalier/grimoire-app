/**
 * Healer Health Covenant — Focus Health Bars
 *
 * Everybody is different. Humans, AI nodes, models, chat windows, networks —
 * Healer does not collapse them into one vibes score.
 * Each sealed Focus gets a recipe of conditions → composite HP 0–100
 * that densens as reality densens (and rots when contact, truth, or loops decay).
 *
 * Pure functions. No disk writes. Atlas + HUD consume this.
 */

import { getFocusType, getSealedChannel, isReceiptSpell } from "./data.js";

/** @typedef {'critical'|'wounded'|'stable'|'vital'|'sovereign'} HealthBand */

/**
 * Default condition craft recipes by focus type.
 * Healer can later store per-Focus overrides in focus.healthCovenant.
 */
export const HEALTH_RECIPES = {
  ai: {
    id: "ai-node-covenant-v1",
    label: "AI Node Covenant",
    conditions: [
      { key: "alignment", label: "Alignment seal", weight: 1.4 },
      { key: "signal", label: "Signal fidelity", weight: 1.2 },
      { key: "dialogue", label: "Dialogue vitality", weight: 1.0 },
      { key: "loop", label: "Spell loop integrity", weight: 1.1 },
      { key: "directives", label: "Directive density", weight: 0.9 },
      { key: "receipts", label: "Receipt hygiene", weight: 0.8 },
      { key: "freshness", label: "Anti-decay freshness", weight: 1.0 },
      { key: "gate", label: "Gate/ward discipline", weight: 0.7 },
    ],
  },
  person: {
    id: "person-covenant-v1",
    label: "Person Covenant",
    conditions: [
      { key: "memory", label: "Memory density", weight: 1.2 },
      { key: "contact", label: "Contact freshness", weight: 1.3 },
      { key: "care", label: "Care / reciprocity loop", weight: 1.1 },
      { key: "identity", label: "Identity clarity", weight: 1.0 },
      { key: "channel", label: "Sealed channel clarity", weight: 0.8 },
      { key: "sent", label: "Outbound courage", weight: 0.9 },
    ],
  },
  network: {
    id: "network-covenant-v1",
    label: "Network Covenant",
    conditions: [
      { key: "purpose", label: "Broadcast purpose", weight: 1.2 },
      { key: "publicSafe", label: "Public-safe wall", weight: 1.4 },
      { key: "cadence", label: "Signal cadence", weight: 1.0 },
      { key: "sent", label: "Outbound signals", weight: 1.1 },
      { key: "audience", label: "Audience memory", weight: 0.9 },
    ],
  },
};

const MS_DAY = 86400000;

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function daysSince(ts) {
  if (!ts) return 999;
  return (Date.now() - Number(ts)) / MS_DAY;
}

function lastActivityTs(convo, focusSpells) {
  let max = 0;
  for (const m of convo.messages || []) {
    if (m.ts && m.ts > max) max = m.ts;
  }
  for (const s of focusSpells || []) {
    if (s.createdAt && s.createdAt > max) max = s.createdAt;
    if (s.sentAt && s.sentAt > max) max = s.sentAt;
  }
  return max || convo.createdAt || 0;
}

function pct(score) {
  return clamp(Math.round(score), 0, 100);
}

function scoreAiConditions(convo, focusSpells, profile) {
  const msgs = convo.messages || [];
  const userMsgs = msgs.filter((m) => m.role === "user");
  const aligned = Boolean(
    convo.alignmentRevealed || convo.alignmentReceived || convo.alignmentNotes || profile?.directives?.length
  );
  const signal = profile?.signal != null ? Number(profile.signal) : aligned ? 6 : 3;
  const dirs = (profile?.directives || []).length;
  const ready = focusSpells.filter((s) => s.status !== "sent" && !isReceiptSpell(s));
  const sent = focusSpells.filter((s) => s.status === "sent");
  const receipts = focusSpells.filter((s) => isReceiptSpell(s));
  const last = lastActivityTs(convo, focusSpells);
  const ageDays = daysSince(last);

  const alignment = aligned ? 100 : msgs.some((m) => m.kind === "alignment-directive") ? 35 : 10;
  const signalScore = clamp((signal / 10) * 100, 0, 100);
  const dialogue = clamp(userMsgs.length * 12 + (userMsgs.some((m) => (m.text || "").length > 200) ? 25 : 0), 0, 100);
  // Loop: rewarded for sent spells and not drowning only in ready receipts
  let loop = 20;
  if (sent.length) loop += Math.min(50, sent.length * 18);
  if (ready.length && ready.length <= 6) loop += 20;
  if (ready.length > 12) loop -= 25;
  loop = clamp(loop, 0, 100);
  const directives = clamp(dirs * 18 + (profile?.capabilities?.length || 0) * 5, aligned ? 25 : 0, 100);
  // Receipt hygiene — pure receipt spam tanks score
  let receiptsScore = 85;
  if (receipts.length && receipts.length >= Math.max(1, focusSpells.length * 0.5)) receiptsScore = 30;
  if (receipts.length > focusSpells.length) receiptsScore = 15;
  if (!focusSpells.length) receiptsScore = 70;
  // Freshness — Healer decay axiom
  let freshness = 100;
  if (ageDays > 3) freshness = 85;
  if (ageDays > 7) freshness = 60;
  if (ageDays > 14) freshness = 35;
  if (ageDays > 30) freshness = 15;
  if (!last) freshness = 40;
  // Gate discipline — structure language presents
  const textBlob = userMsgs.map((m) => m.text || "").join("\n");
  let gate = aligned ? 55 : 25;
  if (/ACTION TAKEN|EVIDENCE|NEXT THREE|PASS\s*\/\s*FAIL|Pulse\s*:/i.test(textBlob)) gate += 30;
  if (/lane|mutation|FORBIDDEN|write only/i.test(textBlob)) gate += 15;
  gate = clamp(gate, 0, 100);

  return {
    alignment: pct(alignment),
    signal: pct(signalScore),
    dialogue: pct(dialogue),
    loop: pct(loop),
    directives: pct(directives),
    receipts: pct(receiptsScore),
    freshness: pct(freshness),
    gate: pct(gate),
  };
}

function scorePersonConditions(convo, focusSpells) {
  const msgs = convo.messages || [];
  const userMsgs = msgs.filter((m) => m.role === "user");
  const sent = focusSpells.filter((s) => s.status === "sent");
  const ready = focusSpells.filter((s) => s.status !== "sent");
  const last = lastActivityTs(convo, focusSpells);
  const ageDays = daysSince(last);
  const blob = userMsgs.map((m) => m.text || "").join("\n");

  const memory = clamp(userMsgs.length * 15 + (blob.length > 400 ? 20 : 0), 0, 100);
  let contact = 100;
  if (ageDays > 2) contact = 80;
  if (ageDays > 7) contact = 50;
  if (ageDays > 21) contact = 20;
  if (!last) contact = 40;
  // Care loop: outbound messages/actions + any reply-ish grimoire notes
  let care = 30;
  if (sent.length) care += Math.min(40, sent.length * 15);
  if (/thank|love|meet|help|care|promise|family|safe/i.test(blob)) care += 25;
  if (ready.some((s) => /action|care|meet|help/i.test(s.purpose || ""))) care += 15;
  care = clamp(care, 0, 100);
  const identity = clamp(
    (convo.name && convo.name !== "Person" ? 40 : 10) +
      (/prefer|love language|work|need|boundary|who they/i.test(blob) ? 40 : 15) +
      userMsgs.length * 5,
    0,
    100
  );
  const channel = getSealedChannel(convo) && getSealedChannel(convo) !== "—" ? 90 : 30;
  const sentScore = clamp(sent.length * 25 + (ready.length ? 20 : 0), ready.length || sent.length ? 25 : 10, 100);

  return {
    memory: pct(memory),
    contact: pct(contact),
    care: pct(care),
    identity: pct(identity),
    channel: pct(channel),
    sent: pct(sentScore),
  };
}

function scoreNetworkConditions(convo, focusSpells) {
  const msgs = convo.messages || [];
  const userMsgs = msgs.filter((m) => m.role === "user");
  const blob = userMsgs.map((m) => m.text || "").join("\n");
  const sent = focusSpells.filter((s) => s.status === "sent");
  const last = lastActivityTs(convo, focusSpells);
  const ageDays = daysSince(last);

  const purpose = clamp(
    (/post|broadcast|audience|signal|public|field/i.test(blob) ? 70 : 35) + userMsgs.length * 8,
    0,
    100
  );
  let publicSafe = 90;
  if (/(password|private key|ssn|custody|biometric|sacred dump)/i.test(blob)) publicSafe = 15;
  if (/(Write Bridge|EAV|PAP internals|token=)/i.test(blob)) publicSafe = Math.min(publicSafe, 40);
  let cadence = 80;
  if (ageDays > 7) cadence = 55;
  if (ageDays > 21) cadence = 25;
  const sentScore = clamp(sent.length * 30 + (focusSpells.length ? 20 : 10), 10, 100);
  const audience = clamp(userMsgs.length * 18, 15, 100);

  return {
    purpose: pct(purpose),
    publicSAFE: pct(publicSafe),
    publicSafe: pct(publicSafe),
    cadence: pct(cadence),
    sent: pct(sentScore),
    audience: pct(audience),
  };
}

function bandFromHp(hp) {
  if (hp >= 85) return "sovereign";
  if (hp >= 70) return "vital";
  if (hp >= 50) return "stable";
  if (hp >= 30) return "wounded";
  return "critical";
}

function bandColor(band) {
  return (
    {
      critical: "#f43f5e",
      wounded: "#fb923c",
      stable: "#fbbf24",
      vital: "#34d399",
      sovereign: "#a78bfa",
    }[band] || "#94a3b8"
  );
}

/**
 * Resolve recipe for focus — custom covenant wins.
 * custom: { id, label, conditions: [{key,label,weight}], scores?: {key: number} }
 */
export function resolveHealthRecipe(convo) {
  const t = getFocusType(convo);
  const custom = convo?.healthCovenant;
  if (custom?.conditions?.length) {
    return {
      id: custom.id || "custom-covenant",
      label: custom.label || "Healer Covenant (custom)",
      conditions: custom.conditions,
      customScores: custom.scores || null,
      custom: true,
    };
  }
  return { ...(HEALTH_RECIPES[t] || HEALTH_RECIPES.ai), custom: false, customScores: null };
}

/**
 * Compute full health report for a Focus.
 * @returns {{
 *   hp: number,
 *   band: HealthBand,
 *   color: string,
 *   label: string,
 *   recipeId: string,
 *   focusType: string,
 *   conditions: Array<{key,label,score,weight,weighted}>,
 *   summary: string,
 *   healerNote: string
 * }}
 */
export function computeFocusHealth(convo, spells = []) {
  if (!convo) {
    return {
      hp: 0,
      band: "critical",
      color: bandColor("critical"),
      label: "No Focus",
      recipeId: "void",
      focusType: "void",
      conditions: [],
      summary: "Select a sealed Focus to compute Healer health.",
      healerNote: "Health is relational — no vessel, no bar.",
    };
  }

  const focusType = getFocusType(convo);
  const focusSpells = (spells || []).filter((s) => s.conversationId === convo.id);
  const profile = convo.alignmentProfile || {};
  const recipe = resolveHealthRecipe(convo);

  let rawScores;
  if (recipe.customScores) {
    rawScores = { ...recipe.customScores };
  } else if (focusType === "person") {
    rawScores = scorePersonConditions(convo, focusSpells);
  } else if (focusType === "network") {
    rawScores = scoreNetworkConditions(convo, focusSpells);
  } else {
    rawScores = scoreAiConditions(convo, focusSpells, profile);
  }

  // Optional operator overrides stored on focus.healthScores
  if (convo.healthScores && typeof convo.healthScores === "object") {
    rawScores = { ...rawScores, ...convo.healthScores };
  }

  const conditions = [];
  let weightSum = 0;
  let acc = 0;
  for (const c of recipe.conditions) {
    const score = pct(rawScores[c.key] != null ? Number(rawScores[c.key]) : 50);
    const w = Number(c.weight) || 1;
    weightSum += w;
    acc += score * w;
    conditions.push({
      key: c.key,
      label: c.label,
      score,
      weight: w,
      weighted: Math.round(score * w),
    });
  }
  const hp = weightSum ? pct(acc / weightSum) : 0;
  const band = bandFromHp(hp);
  const weak = [...conditions].sort((a, b) => a.score - b.score).slice(0, 2);
  const strong = [...conditions].sort((a, b) => b.score - a.score)[0];

  const summary = `${convo.name} · ${recipe.label} · HP ${hp}/100 · ${band.toUpperCase()}`;
  const healerNote = weak.length
    ? `Weakest gates: ${weak.map((w) => `${w.label} ${w.score}`).join(" · ")}. Strongest: ${strong?.label || "—"} ${strong?.score ?? ""}. Healer raises health by densening truth — not by lying to the bar.`
    : "No conditions defined.";

  return {
    hp,
    band,
    color: bandColor(band),
    label: recipe.label,
    recipeId: recipe.id,
    focusType,
    conditions,
    summary,
    healerNote,
    sealed: getSealedChannel(convo),
    lastRecalculated: Date.now(),
  };
}

/** Compact HUD string */
export function healthHudChip(health) {
  if (!health) return "HP —";
  return `HP ${health.hp} · ${health.band}`;
}

/**
 * Suggest Healer spell purpose from weakest conditions (prompt magic).
 */
export function healerHealthSpellHint(health) {
  if (!health?.conditions?.length) return "Integrity Scan — establish health covenant";
  const weak = [...health.conditions].sort((a, b) => a.score - b.score)[0];
  return `Restore ${weak.label} (score ${weak.score})`;
}
