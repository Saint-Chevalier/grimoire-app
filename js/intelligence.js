/**
 * Local-first intelligence vault — GRIMOIRE-FocusIntelligence/
 *
 * - User picks parent once via showDirectoryPicker
 * - App creates GRIMOIRE-FocusIntelligence/ + README.md
 * - Handle stored in IndexedDB (FileSystemHandle) + localStorage flags
 * - One .md per sealed Focus; event log appends on spell/alignment
 * - Download ONLY if File System Access API is unavailable
 */

import {
  getFocusType,
  getSealedChannel,
  isAlignmentSpell,
  formatSpellMarkdown,
} from "./data.js";
import { computeFocusHealth } from "./health.js";

const IDB_NAME = "grimoire-intel-v1";
const IDB_STORE = "handles";
const IDB_KEY = "intelligence-dir";
const LS_SETUP = "grimoire-intel-folder-ready";
const LS_NAME = "grimoire-intel-folder-name";
const INTEL_DIR_NAME = "GRIMOIRE-FocusIntelligence";

/** @type {FileSystemDirectoryHandle|null} */
let dirHandle = null;

// ─── IndexedDB handle persistence (Chromium) ───

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export function hasDirectoryPicker() {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function"
  );
}

export function getCachedDirHandle() {
  return dirHandle;
}

/**
 * Prompt: pick parent → create GRIMOIRE-FocusIntelligence/ → README.
 */
export async function chooseIntelligenceFolder() {
  if (!hasDirectoryPicker()) {
    throw new Error("File System Access API not available in this browser");
  }

  // Browsers require a user gesture; picker chooses parent location
  const parent = await window.showDirectoryPicker({
    id: "grimoire-intelligence-parent",
    mode: "readwrite",
    startIn: "documents",
  });

  // If user already selected the vault folder itself, use it
  let handle;
  if (parent.name === INTEL_DIR_NAME) {
    handle = parent;
  } else {
    handle = await parent.getDirectoryHandle(INTEL_DIR_NAME, { create: true });
  }

  dirHandle = handle;
  try {
    await idbSet(IDB_KEY, handle);
    localStorage.setItem(LS_SETUP, "1");
    localStorage.setItem(LS_NAME, handle.name || INTEL_DIR_NAME);
  } catch {
    /* memory-only this session */
  }
  await writeReadme(handle);
  return handle;
}

/**
 * First-load / restore: get handle or auto-prompt once.
 */
export async function ensureIntelligenceFolder({ forcePrompt = false } = {}) {
  if (!hasDirectoryPicker()) return null;

  const restored = await restoreIntelligenceFolder();
  if (restored && !forcePrompt) {
    try {
      await writeReadme(restored);
    } catch {
      /* ignore */
    }
    return restored;
  }

  const flag = localStorage.getItem(LS_SETUP);
  if (!forcePrompt && flag === "skipped") return restored || null;
  if (!forcePrompt && flag === "1" && restored) return restored;

  // First visit, force, or lost permission while marked ready → prompt
  try {
    return await chooseIntelligenceFolder();
  } catch (err) {
    if (err?.name === "AbortError") {
      if (!localStorage.getItem(LS_SETUP)) {
        localStorage.setItem(LS_SETUP, "skipped");
      }
      return null;
    }
    throw err;
  }
}

export function isIntelligenceSetupComplete() {
  return localStorage.getItem(LS_SETUP) === "1" || Boolean(dirHandle);
}

export function wasIntelligenceSetupSkipped() {
  return localStorage.getItem(LS_SETUP) === "skipped";
}

const README_BODY = `# GRIMOIRE — Focus Intelligence

This folder is Grimoire's local vault. **One Focus = one sealed channel = one \`.md\` file.**

## Structure

\`\`\`
GRIMOIRE-FocusIntelligence/
  README.md
  Wizard King - Hermes.md
  Wizard King - Grok.md
  Healer - Hermes.md
  ...
\`\`\`

## Rules

1. **Self-initializing** — pick a parent folder once; Grimoire creates this vault.
2. **Channel purity** — each file is ONE receiver only.
3. **Living logs** — every spell cast and alignment reply updates the Focus file.
4. **Survives the app** — if the UI dies, the knowledge stays on disk.

## File sections

- Header (backend, type, sealed channel)
- Alignment Reveal
- Spells ledger + full texts
- Intelligence notes
- Recent user intents
- **Event Log** (timestamped append stream)

_Written by Grimoire · local-first · sealed channel_
`;

const INTERFACE_DIR_NAME = "Interfaces";

const KNOWN_BACKENDS = {
  Hermes: {
    name: "Hermes",
    quirks: "Fable 5 primary, MoA off, sovereign sessions, session continuity via paste",
    format: "modular directives, numbered moves, clear success criteria, precision over poetry",
    avoids: "do not invent APIs; respect tool boundaries",
  },
  Grok: {
    name: "Grok",
    quirks: "Public research mode, build tasks via Grok Build, free fallback available",
    format: "direct challenge, signal over noise, sharp operational ask, wit after mission",
    avoids: "no ambiguity; demand specific claims",
  },
  Discord: {
    name: "Discord",
    quirks: "2000 char limit per message, markdown bold/italic only, no headers, bot ping discipline",
    format: "short blocks, no markdown headers, plain text emphasis, respect 2000 char ceiling",
    avoids: "long doctrine dumps, header hierarchies, @everyone pings",
  },
  LinkedIn: {
    name: "LinkedIn",
    quirks: "Anti-spam blocks external links, DM workflow for inbound leads, 3000 char post limit",
    format: "professional tone, no external URLs in posts, DM-first for leads, concise",
    avoids: "link spam, casual slang, long threads",
  },
  Email: {
    name: "Email",
    quirks: "Subject line discipline, threading preservation, signature block",
    format: "clear subject, threaded replies, signature discipline, short paragraphs",
    avoids: "missing subject, broken threads, no signature",
  },
};

async function writeReadme(handle) {
  if (!handle) return;
  try {
    const fh = await handle.getFileHandle("README.md", { create: true });
    const w = await fh.createWritable();
    await w.write(README_BODY);
    await w.close();
  } catch (err) {
    console.warn("README write failed", err);
  }
}

export async function restoreIntelligenceFolder() {
  if (dirHandle) {
    const ok = await ensurePermission(dirHandle);
    return ok ? dirHandle : null;
  }
  try {
    const stored = await idbGet(IDB_KEY);
    if (!stored) return null;
    const ok = await ensurePermission(stored);
    if (!ok) return null;
    dirHandle = stored;
    localStorage.setItem(LS_SETUP, "1");
    return dirHandle;
  } catch {
    return null;
  }
}

async function ensurePermission(handle) {
  if (!handle) return false;
  try {
    const q = await handle.queryPermission({ mode: "readwrite" });
    if (q === "granted") return true;
    const r = await handle.requestPermission({ mode: "readwrite" });
    return r === "granted";
  } catch {
    return false;
  }
}

export async function clearIntelligenceFolder() {
  dirHandle = null;
  try {
    await idbSet(IDB_KEY, null);
    localStorage.removeItem(LS_SETUP);
    localStorage.removeItem(LS_NAME);
  } catch {
    /* ignore */
  }
}

function sanitizeFilePart(s) {
  return (
    String(s || "focus")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "focus"
  );
}

/** Filename: "Wizard King - Hermes.md" */
export function focusFileName(focus) {
  const name = sanitizeFilePart(focus.name);
  const ch = sanitizeFilePart(getSealedChannel(focus));
  return `${name} - ${ch}.md`;
}

function fmtDate(ts = Date.now()) {
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return "unknown";
  }
}

function fmtDateTime(ts = Date.now()) {
  try {
    return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return String(ts);
  }
}

/**
 * Push a timestamped event onto the Focus (persists via app state + disk write).
 */
export function pushFocusEvent(focus, eventType, content) {
  if (!focus) return;
  if (!Array.isArray(focus.eventLog)) focus.eventLog = [];
  focus.eventLog.push({
    ts: Date.now(),
    type: eventType || "EVENT",
    content: String(content || "").trim(),
  });
  // Cap log growth
  if (focus.eventLog.length > 200) {
    focus.eventLog = focus.eventLog.slice(-200);
  }
}

/**
 * Build full intelligence markdown for a Focus from live state.
 */
export function buildFocusMarkdown(focus, spells = []) {
  const backend = getSealedChannel(focus);
  const type = getFocusType(focus);
  const created =
    focus.createdAt ||
    (focus.messages && focus.messages[0]?.ts) ||
    Date.now();
  const focusSpells = (spells || [])
    .filter((s) => s.conversationId === focus.id)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const alignmentSpells = focusSpells.filter((s) => isAlignmentSpell(s));
  const latestAlign = alignmentSpells[alignmentSpells.length - 1];

  const lines = [
    `# ${focus.name} — Intelligence Log`,
    `**Backend:** ${backend}`,
    `**Type:** ${type}`,
    `**Created:** ${fmtDate(created)}`,
    `**Updated:** ${fmtDateTime(Date.now())}`,
    `**Sealed channel:** ${focus.name} · ${backend}`,
    "",
  ];

  lines.push("## Alignment Reveal");
  if (focus.alignmentNotes) {
    lines.push("");
    lines.push(focus.alignmentNotes.trim());
  } else if (latestAlign) {
    lines.push("");
    lines.push(
      "*(Alignment spell forged — paste node reply into Grimoire to lock notes)*"
    );
    lines.push("");
    lines.push("```");
    lines.push(formatSpellMarkdown(latestAlign));
    lines.push("```");
  } else {
    lines.push("");
    lines.push("_No alignment reveal on file yet._");
  }
  lines.push("");

  // Healer Health Covenant snapshot (computed at write time)
  try {
    const health = computeFocusHealth(focus, spells);
    lines.push("## Healer Health Covenant");
    lines.push("");
    lines.push(`**HP:** ${health.hp}/100 · **Band:** ${String(health.band || "").toUpperCase()}`);
    lines.push(`**Recipe:** ${health.label} (\`${health.recipeId}\`)`);
    lines.push("");
    for (const c of health.conditions || []) {
      lines.push(`- ${c.label}: ${c.score}/100 (w${c.weight})`);
    }
    lines.push("");
    lines.push(`_${health.healerNote}_`);
    lines.push("");
  } catch {
    /* health optional */
  }

  lines.push("## Spells");
  if (!focusSpells.length) {
    lines.push("");
    lines.push("_No spells yet._");
  } else {
    lines.push("");
    for (const s of focusSpells) {
      const status = (s.status || "ready").toUpperCase();
      const when = fmtDate(s.createdAt);
      lines.push(`- [${when}] ${s.purpose || "Spell"} — ${status}`);
    }
  }
  lines.push("");

  lines.push("## Spell Texts");
  if (!focusSpells.length) {
    lines.push("");
    lines.push("_None._");
  } else {
    for (const s of focusSpells) {
      lines.push("");
      lines.push(
        `### ${s.purpose || "Spell"} (${(s.status || "ready").toUpperCase()})`
      );
      lines.push("");
      lines.push("```");
      lines.push(formatSpellMarkdown(s));
      lines.push("```");
    }
  }
  lines.push("");

  lines.push("## Intelligence");
  lines.push("");
  const intel = deriveIntelligenceBullets(focus, focusSpells);
  if (!intel.length) {
    lines.push(
      "_No extracted intelligence yet. Cast spells and paste alignment replies._"
    );
  } else {
    for (const b of intel) lines.push(`- ${b}`);
  }
  lines.push("");

  const userMsgs = (focus.messages || [])
    .filter((m) => m.role === "user" && m.text)
    .slice(-12);
  lines.push("## Recent User Intents");
  lines.push("");
  if (!userMsgs.length) {
    lines.push("_None._");
  } else {
    for (const m of userMsgs) {
      lines.push(
        `- [${fmtDate(m.ts)}] ${m.text.replace(/\s+/g, " ").trim().slice(0, 200)}`
      );
    }
  }
  lines.push("");

  // Timestamped event stream (append-style log)
  lines.push("## Event Log");
  lines.push("");
  const events = Array.isArray(focus.eventLog) ? focus.eventLog : [];
  if (!events.length) {
    lines.push("_No events yet._");
  } else {
    for (const ev of events) {
      lines.push(`## [${fmtDateTime(ev.ts)}] — ${ev.type}`);
      lines.push(ev.content || "");
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("_Written by Grimoire · local-first · sealed channel_");
  lines.push("");

  return lines.join("\n");
}

function deriveIntelligenceBullets(focus, spells) {
  const bullets = [];
  const backend = getSealedChannel(focus);
  bullets.push(`Working signal: sealed to **${backend}**`);
  if (focus.alignmentReceived || focus.alignmentNotes) {
    bullets.push("Alignment reply captured on this Focus");
    const notes = (focus.alignmentNotes || "").slice(0, 400);
    const caps = notes.match(/(?:capabilities?|tools?)[:\s—-]+([^\n]+)/i);
    const cons = notes.match(/(?:constraints?|limits?)[:\s—-]+([^\n]+)/i);
    const purpose = notes.match(/(?:primary purpose|purpose)[:\s—-]+([^\n]+)/i);
    if (purpose)
      bullets.push(`Purpose signal: ${purpose[1].trim().slice(0, 160)}`);
    if (caps) bullets.push(`Capability: ${caps[1].trim().slice(0, 160)}`);
    if (cons) bullets.push(`Constraint: ${cons[1].trim().slice(0, 160)}`);
  } else if (spells.some(isAlignmentSpell)) {
    bullets.push("Alignment Reveal spell exists — awaiting node reply paste");
  }
  for (const s of spells.slice(-5)) {
    if (s.essence)
      bullets.push(`Essence (${s.purpose}): ${s.essence.slice(0, 140)}`);
    if (s.crafted) bullets.push(s.crafted);
  }
  return bullets;
}

/**
 * Write Focus intelligence to vault.
 * @param {object} focus
 * @param {array} spells
 * @param {{ allowDownload?: boolean }} [opts]
 *   allowDownload defaults false when FS API exists (stops Downloads spam).
 *   true only when browser has no directory picker at all.
 */
export async function writeFocusIntelligence(focus, spells = [], opts = {}) {
  const content = buildFocusMarkdown(focus, spells);
  const name = focusFileName(focus);
  const fsAvailable = hasDirectoryPicker();
  const allowDownload =
    opts.allowDownload === true || (!fsAvailable && opts.allowDownload !== false);

  const handle = dirHandle || (await restoreIntelligenceFolder());
  if (handle && fsAvailable) {
    try {
      const fileHandle = await handle.getFileHandle(name, { create: true });
      const current = await readExistingFocusText(fileHandle).catch(() => null);
      if (current === content) {
        return { ok: true, method: "filesystem", fileName: name, skipped: true };
      }
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return { ok: true, method: "filesystem", fileName: name };
    } catch (err) {
      console.warn("Intelligence write failed", err);
      return { ok: false, method: "error", fileName: name, error: String(err) };
    }
  }

  if (allowDownload && !fsAvailable) {
    downloadMarkdown(name, content);
    return { ok: true, method: "download", fileName: name };
  }

  return { ok: false, method: "no-folder", fileName: name };
}

async function readExistingFocusText(fileHandle) {
  const file = await fileHandle.getFile();
  return file.text();
}

/**
 * Record event + rewrite Focus file (primary path after spell / alignment).
 */
export async function recordFocusEvent(focus, spells, eventType, content) {
  pushFocusEvent(focus, eventType, content);
  return writeFocusIntelligence(focus, spells);
}

function downloadMarkdown(fileName, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function getFolderLabel() {
  const h = dirHandle || (await restoreIntelligenceFolder());
  if (!h) return null;
  return h.name || localStorage.getItem(LS_NAME) || INTEL_DIR_NAME;
}

export async function ensureFocusFile(focus, spells = []) {
  pushFocusEvent(
    focus,
    "FOCUS_CREATED",
    `Sealed channel opened: ${focus.name} · ${getSealedChannel(focus)}`
  );
  return writeFocusIntelligence(focus, spells);
}

export async function deleteFocusIntelligenceFile(focus) {
  if (!focus) return { ok: false, method: "none" };
  const name = focusFileName(focus);
  const handle = dirHandle || (await restoreIntelligenceFolder());
  if (!handle || !hasDirectoryPicker()) {
    return { ok: false, method: "none", fileName: name };
  }
  try {
    await handle.removeEntry(name);
    return { ok: true, method: "filesystem", fileName: name };
  } catch (err) {
    console.warn("Focus file remove:", err);
    return {
      ok: false,
      method: "filesystem",
      fileName: name,
      error: String(err),
    };
  }
}
