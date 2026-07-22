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
  isCell2CoreFocus,
  isVisibleFocus,
  CELL2_CORE_ID,
  CELL2_CORE_NAME,
  CERTAINTY_LEVELS,
  INTEL_CATEGORIES,
  ensureCertainty,
  classifyIntelCategory,
  normalizeCertainty,
  resolveBusChannel,
  makeBusMessage,
} from "./data.js";
import { computeFocusHealth } from "./health.js";

/** In-memory bus activity (BRAIN bus log) — append-only, capped */
const BUS_ACTIVITY_CAP = 120;
/** @type {array} */
let busActivityLog = [];
/** Memory fallback when vault not linked */
let scrollListMemoryNodes = [];

const IDB_NAME = "grimoire-intel-v1";
const IDB_STORE = "handles";
const IDB_KEY = "intelligence-dir";
const LS_SETUP = "grimoire-intel-folder-ready";
const LS_NAME = "grimoire-intel-folder-name";
const INTEL_DIR_NAME = "GRIMOIRE-FocusIntelligence";

/** Vault-relative path for Cell2 Core intelligence log */
export const CELL2_INTEL_PATH = `${CELL2_CORE_ID}/intelligence.md`;
/** @deprecated alias — use CELL2_INTEL_PATH */
export const CELL2_INTEL_FILE = CELL2_INTEL_PATH;

/** Global AI-node index at vault root */
export const SCROLL_LIST_FILE = "SCROLL-LIST.md";

/** Legacy Cell2 kind map (compat for old callers) → category */
export const CELL2_KINDS = Object.freeze({
  NEURAL_EVENT: "node_intel",
  DOCTRINE: "doctrine",
  REGRESSION: "doctrine",
  node_intel: "node_intel",
  doctrine: "doctrine",
  identity: "identity",
  reality: "reality",
  grievance: "grievance",
  preference: "preference",
  relationship: "relationship",
});

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

const README_BODY = `# GRIMOIRE — Focus Intelligence (Cell2 Substrate)

Local-first vault. **Cell2 Core** is the internal AI intelligence engine (system-level, not a user Focus).

## Structure

\`\`\`
GRIMOIRE-FocusIntelligence/
  README.md
  SCROLL-LIST.md                 ← index of messageable AI nodes (where to read)
  <entity-id>/
    intelligence.md              ← append-only noodle (YAML frontmatter entries)
    images/                      ← permanent image store for this entity
\`\`\`

## Entry format (\`intelligence.md\`)

\`\`\`
---
timestamp: ISO8601
source: Cell2 | <nodename> | user | reality
certainty: confirmed | inferred | unknown | contradicted
category: doctrine | identity | node_intel | reality | grievance | preference | relationship
tags: [comma, separated]
---
Markdown body
\`\`\`

## Rules

1. **Self-initializing** — pick a parent folder once; Grimoire creates this vault.
2. **Append-only** — never truncate \`intelligence.md\` noodles.
3. **SCROLL-LIST first** — other AIs read \`SCROLL-LIST.md\` to find intel paths.
4. **Cell2 Core** — system substrate at \`cell2-core/intelligence.md\` (BRAIN UI).
5. **Survives the app** — if the UI dies, knowledge stays on disk.

_Written by Grimoire · Cell2 · local-first_
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

/** Sanitize entity-id for vault folder names */
export function sanitizeEntityId(idOrName) {
  return (
    String(idOrName || "entity")
      .toLowerCase()
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "entity"
  );
}

/** Entity folder id for a focus (Cell2 → cell2-core) */
export function entityIdFromFocus(focus) {
  if (!focus) return "unknown";
  if (isCell2CoreFocus(focus)) return CELL2_CORE_ID;
  if (focus.id) return sanitizeEntityId(focus.id);
  return sanitizeEntityId(
    `${focus.name || "focus"}-${getSealedChannel(focus) || "open"}`
  );
}

/** Relative path for entity intelligence file */
export function entityIntelPath(entityId) {
  return `${sanitizeEntityId(entityId)}/intelligence.md`;
}

/** Legacy flat filename still used for optional snapshot sidecars */
export function focusFileName(focus) {
  if (isCell2CoreFocus(focus)) return CELL2_INTEL_PATH;
  return entityIntelPath(entityIdFromFocus(focus));
}

/** @deprecated use classifyIntelCategory — maps to category string */
export function classifyCell2Kind(text) {
  const cat = classifyIntelCategory(text);
  if (cat === "doctrine") return "DOCTRINE";
  return "NEURAL_EVENT";
}

/**
 * Format one append-only intelligence entry with YAML frontmatter.
 */
export function formatIntelligenceEntry({
  timestamp,
  source,
  certainty,
  category,
  tags,
  body,
} = {}) {
  const ts =
    timestamp ||
    (() => {
      try {
        return new Date().toISOString();
      } catch {
        return String(Date.now());
      }
    })();
  const src = String(source || "Cell2").trim() || "Cell2";
  const cert = normalizeCertainty(certainty);
  let cat = String(category || "node_intel").toLowerCase().trim();
  if (!INTEL_CATEGORIES.includes(cat)) cat = classifyIntelCategory(body);
  if (!INTEL_CATEGORIES.includes(cat)) cat = "node_intel";
  const tagList = Array.isArray(tags)
    ? tags.map((t) => String(t || "").trim()).filter(Boolean)
    : String(tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
  const tagStr = tagList.length ? tagList.join(", ") : "";
  const md = String(body || "").trim() || "_empty_";
  return [
    `---`,
    `timestamp: ${ts}`,
    `source: ${src}`,
    `certainty: ${cert}`,
    `category: ${cat}`,
    `tags: [${tagStr}]`,
    `---`,
    md,
    ``,
  ].join("\n");
}

/** @deprecated use formatIntelligenceEntry */
export function formatCell2Entry(kind, content, meta = {}) {
  const category =
    CELL2_KINDS[kind] ||
    classifyIntelCategory(content) ||
    "node_intel";
  return formatIntelligenceEntry({
    timestamp: meta.ts
      ? new Date(meta.ts).toISOString()
      : new Date().toISOString(),
    source: meta.source || "Cell2",
    certainty: meta.certainty || "unknown",
    category,
    tags: meta.tags || [String(kind || category).toLowerCase()],
    body: content,
  });
}

function entityIntelHeader(focusOrId) {
  const id =
    typeof focusOrId === "string"
      ? sanitizeEntityId(focusOrId)
      : entityIdFromFocus(focusOrId);
  const name =
    typeof focusOrId === "object" && focusOrId
      ? focusOrId.name || id
      : id === CELL2_CORE_ID
        ? CELL2_CORE_NAME
        : id;
  const ch =
    typeof focusOrId === "object" && focusOrId
      ? getSealedChannel(focusOrId)
      : "—";
  const typ =
    typeof focusOrId === "object" && focusOrId
      ? getFocusType(focusOrId)
      : "entity";
  return [
    `# ${name} — Intelligence Noodle`,
    ``,
    `**Entity id:** \`${id}\``,
    `**Type:** ${typ}`,
    `**Channel:** ${ch}`,
    `**Mode:** append-only · Cell2 substrate`,
    ``,
    `_Entries use YAML frontmatter (timestamp · source · certainty · category · tags). Never truncate._`,
    ``,
  ].join("\n");
}

/**
 * Seed doctrine bootstrap entries for Cell2 Core.
 */
export function seedCell2DoctrineEntries() {
  const now = Date.now();
  return [
    {
      ts: now,
      category: "doctrine",
      certainty: "confirmed",
      source: "Cell2",
      tags: ["doctrine", "type-only", "bootstrap"],
      content:
        "Type-only model. Archetype fields purged forever. Identity = Focus name + type + optional model. Never reintroduce archetype dropdowns or `convo.archetype`.",
    },
    {
      ts: now + 1,
      category: "doctrine",
      certainty: "confirmed",
      source: "Cell2",
      tags: ["doctrine", "lane", "bootstrap"],
      content:
        "Lane boundaries: 1 Focus = 1 sealed channel = one world. Spells densen back to the open Focus nucleus. No cross-channel multiplexing.",
    },
    {
      ts: now + 2,
      category: "doctrine",
      certainty: "confirmed",
      source: "Cell2",
      tags: ["doctrine", "build", "bootstrap"],
      content:
        "Build protocol: verify with node --check, reload localhost, prove the path, then commit and push. No silent half-fixes.",
    },
    {
      ts: now + 3,
      category: "doctrine",
      certainty: "confirmed",
      source: "Cell2",
      tags: ["doctrine", "regression", "bootstrap"],
      content:
        "Anti-regression: do not reintroduce bare `try {` without catch/finally; no string-literal LHS assignments; no null.value / nullLabel purge stubs; no visible Cell2 Focus in the sidebar.",
    },
  ];
}

async function getVaultRoot() {
  if (!hasDirectoryPicker()) return null;
  return dirHandle || (await restoreIntelligenceFolder());
}

async function getEntityDirectory(root, entityId, { create = true } = {}) {
  const id = sanitizeEntityId(entityId);
  const ent = await root.getDirectoryHandle(id, { create });
  await ent.getDirectoryHandle("images", { create: true });
  return ent;
}

async function appendTextToFileHandle(fileHandle, block, { headerIfEmpty } = {}) {
  let existing = "";
  try {
    existing = await readExistingFocusText(fileHandle);
  } catch {
    existing = "";
  }
  if (!existing || !String(existing).trim()) {
    existing = headerIfEmpty || "";
  }
  const next = String(existing).replace(/\s*$/, "") + "\n" + block;
  const writable = await fileHandle.createWritable();
  await writable.write(next);
  await writable.close();
  return next;
}

/**
 * Append-only write to GRIMOIRE-FocusIntelligence/<entity-id>/intelligence.md
 */
export async function appendEntityIntelligence(focusOrId, opts = {}) {
  const focus =
    typeof focusOrId === "object" && focusOrId ? focusOrId : null;
  const entityId = focus
    ? entityIdFromFocus(focus)
    : sanitizeEntityId(focusOrId || opts.entityId || "unknown");

  const body = String(opts.body ?? opts.content ?? "").trim();
  if (!body) return { ok: false, method: "empty", entityId };

  const category =
    opts.category ||
    (opts.kind && CELL2_KINDS[opts.kind]) ||
    classifyIntelCategory(body);
  const certainty = normalizeCertainty(
    opts.certainty || focus?.certainty || "unknown"
  );
  const source = String(opts.source || "Cell2").trim() || "Cell2";
  const tags = opts.tags || [category];
  const ts = opts.timestamp || new Date().toISOString();

  const entry = {
    ts: Date.parse(ts) || Date.now(),
    timestamp: ts,
    source,
    certainty,
    category,
    tags: Array.isArray(tags) ? tags : [String(tags)],
    content: body,
  };

  // In-memory mirror on focus (BRAIN + offline)
  if (focus) {
    if (!Array.isArray(focus.intelLog)) focus.intelLog = [];
    focus.intelLog.push(entry);
    ensureCertainty(focus);
    pushFocusEvent(focus, category, body);
    focus.updatedAt = Date.now();
  }

  const block = formatIntelligenceEntry({
    timestamp: ts,
    source,
    certainty,
    category,
    tags: entry.tags,
    body,
  });
  const relPath = entityIntelPath(entityId);
  const root = await getVaultRoot();

  if (root) {
    try {
      const entDir = await getEntityDirectory(root, entityId, { create: true });
      const fh = await entDir.getFileHandle("intelligence.md", { create: true });
      await appendTextToFileHandle(fh, block, {
        headerIfEmpty: entityIntelHeader(focus || entityId),
      });
      return {
        ok: true,
        method: "filesystem",
        fileName: relPath,
        entityId,
        entry,
      };
    } catch (err) {
      console.warn("appendEntityIntelligence failed", err);
      return {
        ok: false,
        method: "error",
        fileName: relPath,
        entityId,
        error: String(err),
        entry,
      };
    }
  }

  return {
    ok: true,
    method: "memory",
    fileName: relPath,
    entityId,
    entry,
  };
}

/** Cell2 Core append — system substrate only */
export async function appendCell2Intelligence(focus, opts = {}) {
  const cell2 = focus && isCell2CoreFocus(focus) ? focus : { id: CELL2_CORE_ID, name: CELL2_CORE_NAME, type: "ai", system: true, hidden: true };
  return appendEntityIntelligence(cell2, {
    ...opts,
    source: opts.source || "Cell2",
    category:
      opts.category ||
      (opts.kind && CELL2_KINDS[opts.kind]) ||
      classifyIntelCategory(opts.body || opts.content || ""),
  });
}

/**
 * Read entity intelligence.md (vault or memory).
 */
export async function readEntityIntelligence(focusOrId) {
  const focus =
    typeof focusOrId === "object" && focusOrId ? focusOrId : null;
  const entityId = focus
    ? entityIdFromFocus(focus)
    : sanitizeEntityId(focusOrId || CELL2_CORE_ID);
  const relPath = entityIntelPath(entityId);
  const memEntries = Array.isArray(focus?.intelLog)
    ? focus.intelLog
    : Array.isArray(focus?.neuralLog)
      ? focus.neuralLog
      : [];

  const root = await getVaultRoot();
  if (root) {
    try {
      const entDir = await root.getDirectoryHandle(sanitizeEntityId(entityId), {
        create: false,
      });
      const fh = await entDir.getFileHandle("intelligence.md", { create: false });
      const text = await readExistingFocusText(fh);
      return {
        text,
        entries: memEntries,
        method: "filesystem",
        fileName: relPath,
        entityId,
      };
    } catch {
      /* memory fallback */
    }
  }

  const parts = [entityIntelHeader(focus || entityId)];
  for (const e of memEntries) {
    parts.push(
      formatIntelligenceEntry({
        timestamp: e.timestamp || (e.ts ? new Date(e.ts).toISOString() : new Date().toISOString()),
        source: e.source || "Cell2",
        certainty: e.certainty || "unknown",
        category: e.category || e.kind || "node_intel",
        tags: e.tags,
        body: e.content || e.body || "",
      })
    );
  }
  if (!memEntries.length) {
    parts.push("_No intelligence entries yet._\n");
  }
  return {
    text: parts.join("\n"),
    entries: memEntries,
    method: root ? "memory" : "no-folder",
    fileName: relPath,
    entityId,
  };
}

export async function readCell2IntelligenceLog(focus) {
  return readEntityIntelligence(focus || { id: CELL2_CORE_ID, name: CELL2_CORE_NAME });
}

/**
 * Ensure Cell2 Core entity folder + doctrine seed when vault is ready.
 */
export async function ensureCell2IntelligenceFile(focus) {
  const cell2 =
    focus && isCell2CoreFocus(focus)
      ? focus
      : {
          id: CELL2_CORE_ID,
          name: CELL2_CORE_NAME,
          type: "ai",
          system: true,
          hidden: true,
          certainty: "confirmed",
          intelLog: [],
        };
  if (!Array.isArray(cell2.intelLog)) cell2.intelLog = [];
  const seeds = seedCell2DoctrineEntries();
  if (cell2.intelLog.length === 0) {
    for (const s of seeds) {
      cell2.intelLog.push({
        ts: s.ts,
        timestamp: new Date(s.ts).toISOString(),
        source: s.source,
        certainty: s.certainty,
        category: s.category,
        tags: s.tags,
        content: s.content,
      });
    }
  }

  const root = await getVaultRoot();
  const relPath = entityIntelPath(CELL2_CORE_ID);
  if (!root) {
    return { ok: true, method: "memory", fileName: relPath };
  }
  try {
    const entDir = await getEntityDirectory(root, CELL2_CORE_ID, { create: true });
    const fh = await entDir.getFileHandle("intelligence.md", { create: true });
    const existing = await readExistingFocusText(fh).catch(() => "");
    if (existing && String(existing).trim()) {
      return { ok: true, method: "filesystem", fileName: relPath, skipped: true };
    }
    let body = entityIntelHeader(cell2);
    for (const s of cell2.intelLog) {
      body +=
        "\n" +
        formatIntelligenceEntry({
          timestamp: s.timestamp || new Date(s.ts || Date.now()).toISOString(),
          source: s.source || "Cell2",
          certainty: s.certainty || "confirmed",
          category: s.category || "doctrine",
          tags: s.tags,
          body: s.content,
        });
    }
    const w = await fh.createWritable();
    await w.write(body);
    await w.close();
    return { ok: true, method: "filesystem", fileName: relPath };
  } catch (err) {
    console.warn("ensureCell2IntelligenceFile failed", err);
    return { ok: false, method: "error", fileName: relPath, error: String(err) };
  }
}

/**
 * Push Cell2 Message Bus activity (in-memory; BRAIN panel reads this).
 */
export function pushBusActivity(entry) {
  const row = {
    ts: Date.now(),
    timestamp: new Date().toISOString(),
    kind: entry?.kind || "route",
    summary: String(entry?.summary || "").trim(),
    nodeName: entry?.nodeName || "",
    channel: entry?.channel || "",
    localOnly: entry?.localOnly !== false,
    detail: entry?.detail || "",
  };
  busActivityLog.push(row);
  if (busActivityLog.length > BUS_ACTIVITY_CAP) {
    busActivityLog = busActivityLog.slice(-BUS_ACTIVITY_CAP);
  }
  return row;
}

export function getBusActivityLog() {
  return busActivityLog.slice();
}

/** Build SCROLL node records from live conversations */
export function buildScrollNodesFromConversations(conversations = []) {
  return (conversations || [])
    .filter((c) => {
      if (!c || isCell2CoreFocus(c)) return false;
      return isVisibleFocus(c);
    })
    .map((n) => {
      const eid = entityIdFromFocus(n);
      const purpose =
        n.alignmentProfile?.directives?.[0] ||
        (n.alignmentNotes || "").split("\n").find((l) => l.trim())?.slice(0, 120) ||
        (n.messages || []).find((m) => m.role === "grimoire")?.text?.slice(0, 120) ||
        `${n.name} node`;
      return {
        name: String(n.name || eid),
        poe: resolveBusChannel(n),
        purpose: String(purpose).replace(/\s+/g, " ").trim().slice(0, 200),
        certainty: ensureCertainty(n),
        last_updated: new Date(
          n.updatedAt || n.lastViewedAt || n.createdAt || Date.now()
        ).toISOString(),
        intel_file_path: entityIntelPath(eid),
        entity_id: eid,
        type: getFocusType(n),
        focusId: n.id,
      };
    });
}

function renderScrollListMarkdown(nodes) {
  const lines = [
    `# SCROLL LIST — Messageable AI Nodes`,
    ``,
    `Auto-maintained by Cell2 Message Bus. Other AIs read this first to learn **where** to load intelligence.`,
    `Local-only by default. External search is opt-in via \`/bus search\`.`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    `Nodes: ${nodes.length}`,
    ``,
  ];
  for (const n of nodes) {
    lines.push(`---`);
    lines.push(`name: ${JSON.stringify(String(n.name || ""))}`);
    lines.push(`poe: ${JSON.stringify(String(n.poe || "Open"))}`);
    lines.push(
      `purpose: ${JSON.stringify(String(n.purpose || "").replace(/\s+/g, " ").trim().slice(0, 200))}`
    );
    lines.push(`certainty: ${n.certainty || "unknown"}`);
    lines.push(`last_updated: ${n.last_updated || new Date().toISOString()}`);
    lines.push(`intel_file_path: ${n.intel_file_path || ""}`);
    if (n.entity_id) lines.push(`entity_id: ${n.entity_id}`);
    if (n.type) lines.push(`type: ${n.type}`);
    lines.push(`---`);
    lines.push(``);
  }
  if (!nodes.length) {
    lines.push(`_No nodes on the bus yet. Use /bus or seal a Focus._`);
    lines.push(``);
  }
  return lines.join("\n");
}

/**
 * Parse SCROLL-LIST.md YAML frontmatter blocks into node records.
 */
export function parseScrollListMarkdown(text) {
  const nodes = [];
  const src = String(text || "");
  const blocks = src.split(/^---\s*$/m).map((b) => b.trim()).filter(Boolean);
  let pending = null;
  for (const block of blocks) {
    if (!/\bname\s*:/i.test(block) || !/\bpoe\s*:/i.test(block)) continue;
    const get = (key) => {
      const re = new RegExp(`^${key}\\s*:\\s*(.*)$`, "im");
      const m = block.match(re);
      if (!m) return "";
      let v = m[1].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        try {
          v = JSON.parse(v.replace(/^'/, '"').replace(/'$/, '"'));
        } catch {
          v = v.slice(1, -1);
        }
      }
      return String(v || "").trim();
    };
    const name = get("name");
    if (!name) continue;
    nodes.push({
      name,
      poe: get("poe") || "Open",
      purpose: get("purpose") || "",
      certainty: get("certainty") || "unknown",
      last_updated: get("last_updated") || "",
      intel_file_path: get("intel_file_path") || "",
      entity_id: get("entity_id") || "",
      type: get("type") || "",
    });
  }
  return nodes;
}

/**
 * Read master node registry: vault SCROLL-LIST.md, else memory, else conversations.
 */
export async function readScrollListNodes(conversations = []) {
  const fromConvos = buildScrollNodesFromConversations(conversations);
  const root = await getVaultRoot();
  if (root) {
    try {
      const fh = await root.getFileHandle(SCROLL_LIST_FILE, { create: false });
      const text = await readExistingFocusText(fh);
      const parsed = parseScrollListMarkdown(text);
      if (parsed.length) {
        // Merge: vault nodes first, fill focusId from conversations when names match
        const byName = new Map(
          fromConvos.map((n) => [n.name.toLowerCase(), n])
        );
        for (const p of parsed) {
          const hit = byName.get(String(p.name).toLowerCase());
          if (hit) {
            p.focusId = hit.focusId;
            p.entity_id = p.entity_id || hit.entity_id;
            p.type = p.type || hit.type;
          }
        }
        scrollListMemoryNodes = parsed;
        return { nodes: parsed, method: "filesystem", text };
      }
    } catch {
      /* fall through */
    }
  }
  if (scrollListMemoryNodes.length) {
    return { nodes: scrollListMemoryNodes, method: "memory" };
  }
  scrollListMemoryNodes = fromConvos;
  return {
    nodes: fromConvos,
    method: "conversations",
    text: renderScrollListMarkdown(fromConvos),
  };
}

/**
 * Resolve nodename against SCROLL list (and optional multi-word rest string).
 */
export function resolveScrollNode(nodeName, nodes = [], opts = {}) {
  const q = String(nodeName || "").trim().toLowerCase();
  if (!q) return null;
  const list = nodes || [];

  // Exact
  let hit = list.find((n) => String(n.name || "").toLowerCase() === q);
  if (hit) return hit;

  // Multi-word: try longest prefix match from nodeNameRest
  const rest = String(opts.nodeNameRest || "").trim();
  if (rest) {
    const lower = rest.toLowerCase();
    const ranked = list
      .map((n) => {
        const nm = String(n.name || "").toLowerCase();
        if (lower === nm || lower.startsWith(nm + " ")) {
          return { n, score: nm.length };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    if (ranked[0]) {
      const best = ranked[0];
      const msg = rest.slice(best.n.name.length).trim();
      return { ...best.n, _resolvedMessage: msg };
    }
  }

  // Starts-with / includes
  hit = list.find((n) => String(n.name || "").toLowerCase().startsWith(q));
  if (hit) return hit;
  hit = list.find((n) => String(n.name || "").toLowerCase().includes(q));
  return hit || null;
}

/**
 * Auto-maintain SCROLL-LIST.md — index of messageable nodes (master registry).
 * Full rewrite of the index file (not a noodle log).
 */
export async function updateScrollListIndex(conversations = [], spells = []) {
  const nodes = buildScrollNodesFromConversations(conversations);
  // Merge any bus-only memory nodes not yet focuses
  for (const m of scrollListMemoryNodes) {
    if (!nodes.some((n) => n.name.toLowerCase() === String(m.name).toLowerCase())) {
      nodes.push(m);
    }
  }
  scrollListMemoryNodes = nodes;
  const content = renderScrollListMarkdown(nodes);
  const root = await getVaultRoot();
  if (!root) {
    return { ok: true, method: "memory", fileName: SCROLL_LIST_FILE, content, nodes };
  }
  try {
    const fh = await root.getFileHandle(SCROLL_LIST_FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
    return { ok: true, method: "filesystem", fileName: SCROLL_LIST_FILE, content, nodes };
  } catch (err) {
    console.warn("updateScrollListIndex failed", err);
    return {
      ok: false,
      method: "error",
      fileName: SCROLL_LIST_FILE,
      error: String(err),
      nodes,
    };
  }
}

/**
 * Register a new bus node into SCROLL-LIST + entity intelligence folder.
 */
export async function registerBusNode(
  { name, poe = "Open", purpose = "", type = "ai" } = {},
  conversations = []
) {
  const clean = String(name || "").trim();
  if (!clean) return { ok: false, reason: "name-required" };
  const channel = resolveBusChannel(poe || "Open");
  const entityId = sanitizeEntityId(`${clean}-${channel}`);
  const node = {
    name: clean,
    poe: channel,
    purpose: String(purpose || `${clean} bus node`).slice(0, 200),
    certainty: "unknown",
    last_updated: new Date().toISOString(),
    intel_file_path: entityIntelPath(entityId),
    entity_id: entityId,
    type: type || "ai",
  };
  // Memory registry
  const idx = scrollListMemoryNodes.findIndex(
    (n) => n.name.toLowerCase() === clean.toLowerCase()
  );
  if (idx >= 0) scrollListMemoryNodes[idx] = { ...scrollListMemoryNodes[idx], ...node };
  else scrollListMemoryNodes.push(node);

  // Seed entity intelligence file
  await appendEntityIntelligence(
    { id: entityId, name: clean, type, backend: channel, medium: channel },
    {
      body: `Bus node registered: **${clean}** · POE ${channel}\nPurpose: ${node.purpose}`,
      source: "Cell2",
      category: "identity",
      certainty: "unknown",
      tags: ["bus", "register", channel],
    }
  );

  const scroll = await updateScrollListIndex(conversations);
  pushBusActivity({
    kind: "register",
    summary: `Registered bus node **${clean}** · ${channel}`,
    nodeName: clean,
    channel,
    localOnly: true,
  });
  return { ok: true, node, scroll };
}

/**
 * Densen a bus message into the target node's intelligence.md (YAML entry).
 */
export async function densenBusMessage(nodeOrFocus, message, opts = {}) {
  const name =
    typeof nodeOrFocus === "object"
      ? nodeOrFocus.name || nodeOrFocus.id
      : String(nodeOrFocus || "");
  const channel =
    opts.channel ||
    (typeof nodeOrFocus === "object"
      ? resolveBusChannel(nodeOrFocus)
      : "Open");
  const body = String(message || opts.body || "").trim();
  if (!body) return { ok: false, method: "empty" };

  const focusLike =
    typeof nodeOrFocus === "object" && nodeOrFocus
      ? nodeOrFocus
      : {
          id: sanitizeEntityId(`${name}-${channel}`),
          name,
          type: opts.type || "ai",
          backend: channel,
          medium: channel,
        };

  const bus = makeBusMessage({
    to: name,
    from: opts.from || "user",
    body,
    channel,
    kind: opts.kind || "route",
    localOnly: opts.localOnly !== false,
  });

  const result = await appendEntityIntelligence(focusLike, {
    body: [
      `**Cell2 Message Bus** · ${bus.kind}`,
      `To: **${bus.to}** · Channel: **${bus.channel}** · From: ${bus.from}`,
      ``,
      bus.body,
    ].join("\n"),
    source: opts.source || "user",
    category: opts.category || "node_intel",
    certainty: opts.certainty || "inferred",
    tags: ["bus", bus.kind, bus.channel].filter(Boolean),
  });

  pushBusActivity({
    kind: bus.kind,
    summary: `Bus → **${name}** · ${channel}: ${body.slice(0, 120)}`,
    nodeName: name,
    channel,
    localOnly: bus.localOnly,
    detail: body.slice(0, 500),
  });

  return { ok: true, bus, result };
}

/**
 * Local vault search only (no network). Scans SCROLL names + in-memory intel snippets.
 */
export async function searchBusLocal(query, conversations = []) {
  const q = String(query || "").trim().toLowerCase();
  const { nodes } = await readScrollListNodes(conversations);
  if (!q) {
    return { hits: nodes.slice(0, 20), method: "local", query: q };
  }
  const hits = [];
  for (const n of nodes) {
    const hay = [n.name, n.poe, n.purpose, n.entity_id, n.type]
      .join(" ")
      .toLowerCase();
    if (hay.includes(q)) hits.push({ ...n, match: "scroll" });
  }
  for (const c of conversations || []) {
    if (isCell2CoreFocus(c) || !isVisibleFocus(c)) continue;
    const log = Array.isArray(c.intelLog) ? c.intelLog : [];
    for (const e of log.slice(-30)) {
      const body = String(e.content || e.body || "");
      if (body.toLowerCase().includes(q)) {
        hits.push({
          name: c.name,
          poe: getSealedChannel(c),
          purpose: body.slice(0, 160),
          certainty: e.certainty || "unknown",
          intel_file_path: entityIntelPath(entityIdFromFocus(c)),
          focusId: c.id,
          match: "intel",
        });
        break;
      }
    }
  }
  pushBusActivity({
    kind: "search_local",
    summary: `Local bus search: “${query}” → ${hits.length} hit(s)`,
    localOnly: true,
    detail: q,
  });
  return { hits, method: "local", query: q };
}

/**
 * Relay structured intel from source Focus into dest session (local only).
 * Returns markdown snippet for chat injection — densens into dest vault too.
 */
export async function relayIntelBetweenFocuses(sourceFocus, destFocus, hint = "") {
  if (!sourceFocus || !destFocus) return { ok: false, text: "" };
  const bits = [];
  const channel = getSealedChannel(sourceFocus);
  bits.push(`### Relay from **${sourceFocus.name}** · ${channel}`);
  if (sourceFocus.alignmentNotes) {
    bits.push(String(sourceFocus.alignmentNotes).slice(0, 600));
  }
  const log = Array.isArray(sourceFocus.intelLog) ? sourceFocus.intelLog : [];
  const recent = log.slice(-5);
  for (const e of recent) {
    bits.push(
      `- [${e.category || "intel"} · ${e.certainty || "unknown"}] ${String(e.content || "").slice(0, 200)}`
    );
  }
  if (hint) bits.push(`_Hint: ${String(hint).slice(0, 200)}_`);
  if (bits.length < 2) {
    bits.push("_No densened intelligence on file yet for this node._");
  }
  const text = bits.join("\n");
  await appendEntityIntelligence(destFocus, {
    body: text,
    source: "Cell2",
    category: "relationship",
    certainty: "inferred",
    tags: ["bus", "relay", sourceFocus.name],
  });
  pushBusActivity({
    kind: "relay",
    summary: `Relay **${sourceFocus.name}** → **${destFocus.name}**`,
    nodeName: sourceFocus.name,
    channel,
    localOnly: true,
  });
  return { ok: true, text };
}

/**
 * Save image under entity images/ and index metadata into intelligence.md.
 * @param {object} focus
 * @param {string} dataUrl - data:image/...;base64,...
 * @param {object} [meta]
 */
export async function saveEntityImage(focus, dataUrl, meta = {}) {
  if (!focus || !dataUrl) return { ok: false, method: "empty" };
  const entityId = entityIdFromFocus(focus);
  const root = await getVaultRoot();
  const ts = Date.now();
  const ext = /image\/png/i.test(dataUrl)
    ? "png"
    : /image\/webp/i.test(dataUrl)
      ? "webp"
      : "jpg";
  const fileName = `img-${ts}.${ext}`;
  const relImage = `${entityId}/images/${fileName}`;

  let method = "memory";
  if (root) {
    try {
      const entDir = await getEntityDirectory(root, entityId, { create: true });
      const imgDir = await entDir.getDirectoryHandle("images", { create: true });
      const comma = dataUrl.indexOf(",");
      const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const fh = await imgDir.getFileHandle(fileName, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      method = "filesystem";
    } catch (err) {
      console.warn("saveEntityImage failed", err);
      return { ok: false, method: "error", error: String(err), entityId };
    }
  }

  const caption = String(meta.caption || meta.context || "").trim();
  const body = [
    `**Image captured** \`${fileName}\``,
    `Path: \`${relImage}\``,
    caption ? `Context: ${caption.slice(0, 500)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const intel = await appendEntityIntelligence(focus, {
    body,
    source: meta.source || "user",
    certainty: meta.certainty || "confirmed",
    category: "reality",
    tags: ["image", "visual", fileName],
  });

  return {
    ok: true,
    method: intel.method === "filesystem" || method === "filesystem" ? "filesystem" : method,
    fileName: relImage,
    entityId,
    intel,
  };
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
 * SCROLL LIST — compact transferable manifest of nodes this Focus has touched.
 * Sources: nucleus Focus + derivedNodes + sealed node-engage spells (+ returned intel).
 */
export function buildScrollList(focus, spells = []) {
  const byKey = new Map();

  function upsert(entry) {
    if (!entry?.name) return;
    const key = `${String(entry.name).toLowerCase()}::${String(entry.channel || "open").toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || (entry.updated || 0) >= (prev.updated || 0)) {
      byKey.set(key, entry);
    }
  }

  // 1) Nucleus Focus
  if (focus) {
    upsert({
      name: focus.name,
      channel: getSealedChannel(focus),
      nodeType: getFocusType(focus),
      role: "nucleus",
      snippet:
        (focus.alignmentNotes || "").trim().slice(0, 240) ||
        (focus.messages || [])
          .slice(-3)
          .map((m) => String(m?.text || "").trim())
          .filter(Boolean)
          .join(" / ")
          .slice(0, 240) ||
        "Nucleus Focus — sealed channel.",
      updated: focus.updatedAt || focus.createdAt || Date.now(),
    });
  }

  // 2) Operator-derived nodes (returned intel densen)
  for (const node of focus?.derivedNodes || []) {
    upsert({
      name: node?.name || node?.id || "Unknown Node",
      channel: node?.channel || node?.backend || getSealedChannel(node) || "Open",
      nodeType: node?.type || node?.nodeType || getFocusType(node) || "node",
      role: node?.role || "derived",
      snippet:
        String(node?.snippet || node?.alignmentNotes || node?.intel || "").trim().slice(0, 240) ||
        "Engaged node — densen pending.",
      updated: node?.updatedAt || node?.createdAt || Date.now(),
    });
  }

  // 3) Node-engagement spells (ready or sealed) — proactive WYFWYG packets
  const focusSpells = (spells || []).filter((s) => s && s.conversationId === focus?.id);
  for (const s of focusSpells) {
    const isEngage =
      s.kind === "node-engage" ||
      /^ENGAGE\s*[·.]/i.test(String(s.purpose || "")) ||
      Boolean(s.engageNodeId || s.targetFocusId);
    if (!isEngage && !s.target) continue;
    if (!isEngage && s.target === focus?.name) continue;

    const name = s.engageNodeName || s.target || "Node";
    const channel = s.engageNodeChannel || s.medium || "Open";
    const snippet =
      String(s.answerExcerpt || "").trim().slice(0, 240) ||
      String(s.essence || "").trim().slice(0, 240) ||
      (s.status === "sent"
        ? "Engagement cast — awaiting node reply densen."
        : "Proactive engage spell ready in spell book.");
    upsert({
      name,
      channel,
      nodeType: s.engageNodeType || "node",
      role: s.status === "sent" ? (s.answeredAt ? "engaged-densen" : "engaged-cast") : "engage-ready",
      snippet,
      updated: s.answeredAt || s.sentAt || s.createdAt || Date.now(),
    });
  }

  const entries = [...byKey.values()].sort(
    (a, b) => (b.updated || 0) - (a.updated || 0)
  );

  if (!entries.length) {
    return "_No nodes on this scroll yet. Start casting to grow the list._";
  }

  const lines = [
    `# SCROLL LIST — ${focus?.name || "Focus"}`,
    `Generated: ${fmtDateTime(Date.now())}`,
    `Nodes: ${entries.length}`,
    `Model: proactive node engagement (WYFWYG) — Focus forges packets; operator dispatches; replies densen the scroll.`,
    "",
  ];

  for (const e of entries) {
    const role = e.role ? ` · ${e.role}` : "";
    lines.push(`### ${e.name} · ${e.channel} · ${e.nodeType}${role}`);
    lines.push(String(e.snippet || "").trim() || "_No intel yet._");
    lines.push("");
  }

  lines.push("---");
  lines.push("_One paste = full Focus transfer into any AI._");
  lines.push("_ENGAGE spells target unengaged nodes; paste replies here to update this list._");
  return lines.join("\n");
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

  lines.push("## SCROLL LIST");
  lines.push("");
  lines.push(buildScrollList(focus, spells));
  lines.push("");

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
 * Write vault content. Prefer entity-folder paths; allow root sidecars via opts.fileName.
 * Snapshot writes still never truncate intelligence.md noodles (use appendEntityIntelligence).
 */
export async function writeFocusIntelligence(focus, spells = [], opts = {}) {
  // Explicit root sidecar (e.g. SCROLL-LIST.md or custom manifest)
  if (typeof opts.fileName === "string" && opts.fileName.trim() && !opts.fileName.includes("/")) {
    const content =
      typeof opts.content === "string"
        ? opts.content
        : typeof focus?._scrollListContent === "string"
          ? focus._scrollListContent
          : buildFocusMarkdown(focus, spells);
    const name = opts.fileName.trim();
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

  // Default: append a densen snapshot entry into entity intelligence.md (append-only)
  if (focus) {
    const snap =
      typeof opts.content === "string"
        ? opts.content
        : `Snapshot densen · ${focus.name || entityIdFromFocus(focus)} · ${getSealedChannel(focus)}`;
    return appendEntityIntelligence(focus, {
      body: snap.slice(0, 8000),
      source: opts.source || "Cell2",
      category: opts.category || "node_intel",
      certainty: opts.certainty || ensureCertainty(focus),
      tags: opts.tags || ["snapshot"],
    });
  }

  return { ok: false, method: "no-focus" };
}

async function readExistingFocusText(fileHandle) {
  const file = await fileHandle.getFile();
  return file.text();
}

/**
 * Record event + append to entity intelligence.md (append-only).
 */
export async function recordFocusEvent(focus, spells, eventType, content) {
  pushFocusEvent(focus, eventType, content);
  const body = [
    eventType ? `**Event:** ${eventType}` : null,
    String(content || "").trim() || null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await appendEntityIntelligence(focus, {
    body: body || eventType || "event",
    source: "Cell2",
    category: classifyIntelCategory(`${eventType} ${content || ""}`),
    certainty: ensureCertainty(focus),
    tags: [String(eventType || "event").toLowerCase()],
  });
  // Keep SCROLL-LIST fresh when AI nodes densen
  try {
    if (focus && (getFocusType(focus) === "ai" || getFocusType(focus) === "eternal-intelligence")) {
      /* caller may pass full conversation list later */
    }
  } catch {
    /* ignore */
  }
  return result;
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
  if (isCell2CoreFocus(focus)) {
    return { ok: false, method: "protected", fileName: CELL2_INTEL_PATH };
  }
  const entityId = entityIdFromFocus(focus);
  const name = entityIntelPath(entityId);
  const handle = dirHandle || (await restoreIntelligenceFolder());
  if (!handle || !hasDirectoryPicker()) {
    return { ok: false, method: "none", fileName: name };
  }
  try {
    // Remove entire entity folder (intelligence.md + images/)
    await handle.removeEntry(sanitizeEntityId(entityId), { recursive: true });
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
