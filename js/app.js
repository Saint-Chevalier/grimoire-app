/**
 * Grimoire MVP — core loop (GBG: Grimoire Builds Grimoire)
 *
 * AI nodes: alignment-first → then auto-spell on intent
 * Person/network: conversational + auto-propose spells when intent is clear
 * Cast Spell still works; Grimoire also initiates without waiting.
 */

import {
  ARCHETYPES,
  AI_SUBTYPES,
  NETWORK_PLATFORMS,
  PERSON_CHANNELS,
  applyFocusClassification,
  focusExists,
  focusIdentityKey,
  formatSpellMarkdown,
  generateAlignmentSpell,
  generateSpell,
  getFocusType,
  getSealedChannel,
  hasAlignmentSpell,
  hasSpellIntent,
  isAlignmentSpell,
  isReceiptSpell,
  dedupeSpells,
  spellKindKey,
  spellsAreSameKindPurpose,
  loadState,
  makeFocusId,
  parseAlignmentIntelligence,
  saveState,
  sealedChannelLabel,
} from "./data.js";
import {
  randomStarPosition,
  updateConstellation,
  setFocusMetrics,
  liveCapture,
} from "./stars.js";
import {
  initUniverse,
  setFocusUniverse,
  deriveFocusSnapshot,
  universeEvent,
  getUniverseHud,
  universeStage,
} from "./universe.js";
import {
  chooseIntelligenceFolder,
  ensureIntelligenceFolder,
  writeFocusIntelligence,
  recordFocusEvent,
  deleteFocusIntelligenceFile,
  getFolderLabel,
  hasDirectoryPicker,
  wasIntelligenceSetupSkipped,
  isIntelligenceSetupComplete,
  focusFileName,
} from "./intelligence.js";
import {
  computeFocusHealth,
  healthHudChip,
  healerHealthSpellHint,
} from "./health.js";

const SIDEBAR_COLLAPSE_KEY = "grimoire-sidebar-collapsed-v1";

// ─── State ───

const state = loadState();

// ─── DOM ───

const $ = (sel) => document.querySelector(sel);

const els = {
  sidebar: $("#sidebar"),
  btnSidebarToggle: $("#btn-sidebar-toggle"),
  convoList: $("#convo-list"),
  chatMessages: $("#chat-messages"),
  emptyState: $("#empty-state"),
  entityIcon: $("#entity-icon"),
  entityName: $("#entity-name"),
  entityType: $("#entity-type"),
  sealedChannelValue: $("#sealed-channel-value"),
  chatForm: $("#chat-form"),
  chatInput: $("#chat-input"),
  btnSend: $("#btn-send"),
  btnCast: $("#btn-cast-spell"),
  btnAttach: $("#btn-attach"),
  btnNew: $("#btn-new-convo"),
  btnToggleSpells: $("#btn-toggle-spells"),
  btnCloseSpells: $("#btn-close-spells"),
  btnIntelFolder: $("#btn-intel-folder"),
  btnResetApp: $("#btn-reset-app"),
  vaultFailDot: $("#vault-fail-dot"),
  intelFolderStatus: $("#intel-folder-status"),
  btnClearAll: $("#btn-clear-all"),
  spellCount: $("#spell-count") || document.getElementById("spell-count"),
  spellsList: $("#spells-list"),
  constellationPing: $("#constellation-ping"),
  app: $(".app") || document.querySelector(".app"),
  stars: $("#stars"),
  lines: $("#constellation-lines"),
  universeCanvas: $("#universe-canvas"),
  universeStage: $("#universe-stage"),
  universeHud: $("#universe-hud"),
  universeHudCount: $("#universe-hud-count"),
  universeHudStage: $("#universe-hud-stage"),
  universeLegend: $("#universe-legend"),
  atlasTitle: $("#atlas-title"),
  atlasSub: $("#atlas-sub"),
  atlasBody: $("#atlas-body"),
  btnAtlasClose: $("#btn-atlas-close"),
  dialog: $("#new-convo-dialog"),
  newForm: $("#new-convo-form"),
  newName: $("#new-entity-name"),
  newType: $("#new-entity-type"),
  newAiSubtypeLabel: $("#new-ai-subtype-label"),
  newAiSubtype: $("#new-entity-ai-subtype"),
  newChannelLabel: $("#new-channel-label"),
  newChannel: $("#new-entity-channel"),
  btnCancelNew: $("#btn-cancel-new"),
  toast: $("#toast"),
};

// Drop any legacy input-bar background contamination
try {
  localStorage.removeItem("grimoire-input-bg-v1");
} catch {
  /* ignore */
}

/** One-line activity ping above input — fades after 3s. */
function activityPing(message) {
  const el = els.constellationPing || document.getElementById("constellation-ping");
  if (!el || !message) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(activityPing._t);
  activityPing._t = setTimeout(() => {
    el.classList.remove("show");
  }, 3000);
}

function setVaultFailState(failed) {
  const btn = els.btnIntelFolder;
  const dot = els.vaultFailDot || document.getElementById("vault-fail-dot");
  if (btn) btn.classList.toggle("vault-fail", Boolean(failed));
  if (dot) {
    if (failed) dot.removeAttribute("hidden");
    else dot.setAttribute("hidden", "");
  }
}

function applySidebarCollapsed(collapsed) {
  const appEl = els.app || document.querySelector(".app");
  if (!appEl) return;
  appEl.classList.toggle("sidebar-collapsed", Boolean(collapsed));
  if (els.btnSidebarToggle) {
    els.btnSidebarToggle.title = collapsed ? "Expand focuses" : "Collapse focuses";
    els.btnSidebarToggle.setAttribute(
      "aria-label",
      collapsed ? "Expand sidebar" : "Collapse sidebar"
    );
  }
  try {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function loadSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function toggleSidebar() {
  const appEl = els.app || document.querySelector(".app");
  const next = !appEl?.classList.contains("sidebar-collapsed");
  applySidebarCollapsed(next);
}

/** Double-tap delete timers: spellId | 'clear-all' → timeout id */
const pendingDeletes = new Map();
const DELETE_CONFIRM_MS = 3000;

// ─── Helpers ───

function activeConvo() {
  return state.conversations.find((c) => c.id === state.activeId) || null;
}

function spellsFor(convoId) {
  return state.spells
    .filter((s) => s.conversationId === convoId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function pendingCount(convoId) {
  return spellsFor(convoId).filter((s) => s.status !== "sent").length;
}

function persist() {
  saveState(state);
}

function toast(msg, kind = "") {
  els.toast.textContent = msg;
  els.toast.className = "toast show" + (kind ? ` ${kind}` : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    els.toast.className = "toast";
  }, 2200);
}

function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Pulse Protocol trigger: a lone period (optional surrounding whitespace). */
function isPulse(text) {
  return /^\s*\.\s*$/.test(text);
}

/** Focus classifiers — sealed type only (1 Focus = 1 entity). */
function isAiNode(convo) {
  if (!convo) return false;
  const t = String(convo.type || getFocusType(convo) || "").toLowerCase();
  return t === "ai";
}

function isPerson(convo) {
  if (!convo) return false;
  const t = String(convo.type || getFocusType(convo) || "").toLowerCase();
  return t === "person";
}

function isNetwork(convo) {
  if (!convo) return false;
  const t = String(convo.type || getFocusType(convo) || "").toLowerCase();
  return t === "network";
}

/**
 * Pulse Protocol reply — Focus-specific only, no cross-write.
 * Stores/reads pulseCount, lastPulseAt, pendingPulseAction on the convo.
 */
function buildPulseReply(convo, pulseIndex) {
  // Person / Network — no autonomous AI protocol
  if (isPerson(convo) || isNetwork(convo) || !isAiNode(convo)) {
    return "Pulse received. Not AI — spellcraft only.";
  }

  // AI without alignment on file
  if (!convoAlignmentUnlocked(convo)) {
    return "Pulse received. No alignment on file. Cast Spell for Alignment Reveal, paste reply.";
  }

  // Pending action takes priority once aligned
  if (convo.pendingPulseAction) {
    return executePendingPulseAction(convo, pulseIndex);
  }

  const n = convo.alignmentProfile?.directives?.length || 0;
  return `Pulse ${pulseIndex}. Alignment on file (${n} directives). Awaiting onboarded pulse protocol.`;
}

/**
 * Execute and clear pendingPulseAction for this Focus only.
 */
function executePendingPulseAction(convo, pulseIndex) {
  const action = String(convo.pendingPulseAction || "").trim();
  convo.pendingPulseAction = null;

  if (!action) {
    const n = convo.alignmentProfile?.directives?.length || 0;
    return `Pulse ${pulseIndex}. Alignment on file (${n} directives). Awaiting onboarded pulse protocol.`;
  }

  // Known actions (Focus-local only)
  if (/^spell\b|craft|cast/i.test(action)) {
    const spell = generateAndStoreSpell(convo, action, { silentToast: true });
    if (spell?.blocked) {
      return `Pulse ${pulseIndex}. Pending action blocked: ${spell.reason}`;
    }
    if (spell && !spell.blocked) {
      return `Pulse ${pulseIndex}. Executed pending pulse action → spell forged: **${spell.purpose}**. Open Spells panel.`;
    }
  }

  return `Pulse ${pulseIndex}. Executed pending pulse action: ${action}`;
}

function autoResizeTextarea() {
  const ta = els.chatInput;
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
}

/** Sealed channel for active Focus — never rewrites backend. */
function currentMedium(convo) {
  return getSealedChannel(convo);
}

function syncMediumFromControls(convo) {
  // Channel is sealed at creation; spellcraft only reads it.
  return getSealedChannel(convo);
}

function typeLabel(convo) {
  return sealedChannelLabel(convo);
}

function fillNewChannelOptions(type, selected) {
  const opts = type === "network" ? NETWORK_PLATFORMS : PERSON_CHANNELS;
  const sel = els.newChannel;
  if (!sel) return;
  const label = type === "network" ? "Platform" : "Medium";
  if (els.newChannelLabel) {
    // Keep first text node as label
    const textNodes = [...els.newChannelLabel.childNodes].filter(
      (n) => n.nodeType === Node.TEXT_NODE
    );
    if (textNodes[0]) textNodes[0].textContent = `\n        ${label}\n        `;
  }
  sel.innerHTML = opts
    .map(
      (v) =>
        `<option value="${escapeAttr(v)}"${v === selected ? " selected" : ""}>${escapeHtml(v)}</option>`
    )
    .join("");
  if (selected) sel.value = selected;
}

/** Alignment *spell* exists in panel (cast already). */
function convoHasAlignmentSpell(convo) {
  return hasAlignmentSpell(state.spells, convo.id);
}

/** Spellcraft unlocked only after alignment *reply* received. */
function convoAlignmentUnlocked(convo) {
  if (!convo) return false;
  if (convo.alignmentRevealed || convo.alignmentReceived || convo.alignmentNotes)
    return true;
  if (convo.alignmentProfile?.directives?.length) return true;
  return false;
}

/** @deprecated name kept for call sites — means "alignment spell on file" */
function convoHasAlignment(convo) {
  return convoHasAlignmentSpell(convo);
}

function hasAlignmentDirective(convo) {
  return (convo.messages || []).some(
    (m) =>
      m.kind === "alignment-directive" ||
      (m.role === "grimoire" &&
        /Before I can craft precise spells, we need transparency/i.test(
          m.text || ""
        ))
  );
}

// ─── Render: sidebar ───

function renderConvoList() {
  els.convoList.innerHTML = "";
  state.conversations.forEach((c) => {
    const arch = ARCHETYPES[c.archetype] || ARCHETYPES.wizard;
    const pending = pendingCount(c.id);
    const channel = getSealedChannel(c);
    const typeTag =
      getFocusType(c) === "ai"
        ? "AI"
        : getFocusType(c) === "network"
          ? "Network"
          : "Person";
    const row = document.createElement("div");
    row.className = "convo-item" + (c.id === state.activeId ? " active" : "");
    row.setAttribute("role", "listitem");
    row.dataset.focusId = c.id;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "convo-item-main";
    btn.title = `${c.name} · ${channel} (sealed)`;
    btn.innerHTML = `
      <span class="convo-icon" aria-hidden="true">${arch.icon}</span>
      <span class="convo-text">
        <span class="convo-name">${escapeHtml(c.name)}</span>
        <span class="convo-channel-tag">${escapeHtml(channel)}</span>
        <span class="convo-meta">${escapeHtml(typeTag)}</span>
      </span>
      ${pending > 0 ? `<span class="convo-badge">${pending}</span>` : ""}
    `;
    btn.addEventListener("click", () => selectConvo(c.id));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "focus-delete-btn";
    del.title = `Delete focus ${c.name}`;
    del.setAttribute("aria-label", `Delete focus ${c.name}`);
    del.textContent = "✕";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      requestDeleteFocus(c.id);
    });

    row.appendChild(btn);
    row.appendChild(del);
    els.convoList.appendChild(row);
  });
}

/**
 * Permanent Focus delete — spells, chat, intelligence file, localStorage.
 * No undo.
 */
async function requestDeleteFocus(focusId) {
  const focus = state.conversations.find((c) => c.id === focusId);
  if (!focus) return;

  const channel = getSealedChannel(focus);
  const label = `${focus.name} · ${channel}`;
  const ok = window.confirm(
    `Delete ${label}?\n\nThis removes all spells and intelligence data for this sealed channel.\n\nNo undo. Permanent.`
  );
  if (!ok) return;

  await deleteFocus(focusId);
}

async function deleteFocus(focusId) {
  const focus = state.conversations.find((c) => c.id === focusId);
  if (!focus) return;

  const label = `${focus.name} · ${getSealedChannel(focus)}`;

  // Remove spells for this focus
  state.spells = state.spells.filter((s) => s.conversationId !== focusId);

  // Remove focus from list
  state.conversations = state.conversations.filter((c) => c.id !== focusId);

  // Active focus fallback
  if (state.activeId === focusId) {
    state.activeId = state.conversations[0]?.id || null;
  }

  // Disk intelligence file
  try {
    await deleteFocusIntelligenceFile(focus);
  } catch (err) {
    console.warn("Could not remove intelligence file", err);
  }

  persist();
  renderAll();
  toast(`Focus deleted: ${label}`, "success");
}

// ─── Render: chat ───

function setChatControlsEnabled(enabled) {
  if (els.chatInput) els.chatInput.disabled = !enabled;
  if (els.btnSend) els.btnSend.disabled = !enabled;
  if (els.btnCast) els.btnCast.disabled = !enabled;
  if (els.btnAttach) els.btnAttach.disabled = !enabled;
}

function renderChat() {
  const convo = activeConvo();
  els.chatMessages.innerHTML = "";

  if (!convo) {
    els.entityIcon.textContent = "✧";
    els.entityName.textContent = "Select a focus";
    els.entityType.textContent = "—";
    if (els.sealedChannelValue) els.sealedChannelValue.textContent = "—";
    if (els.universeStage) els.universeStage.textContent = "VOID";
    setChatControlsEnabled(false);
    if (els.chatInput) els.chatInput.placeholder = "Select a focus to speak…";
    // Select-a-focus empty state
    const empty =
      els.emptyState ||
      (() => {
        const d = document.createElement("div");
        d.className = "empty-state";
        d.id = "empty-state";
        d.innerHTML = `
          <div class="empty-glyph">✧</div>
          <p>Open a focus. Speak to Grimoire about that focus target.</p>
          <p class="empty-hint">Spells you craft will appear in the right panel — copy, send, mark as Sent.</p>
        `;
        els.emptyState = d;
        return d;
      })();
    els.chatMessages.appendChild(empty);
    return;
  }

  const arch = ARCHETYPES[convo.archetype] || ARCHETYPES.wizard;
  els.entityIcon.textContent = arch.icon;
  els.entityName.textContent = convo.name;
  els.entityType.textContent = typeLabel(convo);
  if (els.sealedChannelValue) {
    els.sealedChannelValue.textContent = getSealedChannel(convo);
  }
  // Universe stage under focus name: e.g. EXPANSION
  if (els.universeStage) {
    const snap = deriveFocusSnapshot(convo, state.spells);
    const st = universeStage(snap.intelCount, snap.spellsSent, snap.aligned);
    els.universeStage.textContent = `${getSealedChannel(convo)} · ${st.name}`;
  }
  setChatControlsEnabled(true);

  if (isAiNode(convo) && !convoHasAlignment(convo)) {
    els.chatInput.placeholder = `Speak about ${convo.name} — or Cast Spell for Alignment Reveal…`;
  } else {
    els.chatInput.placeholder = `Speak to Grimoire about ${convo.name}…`;
  }

  if (!convo.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <div class="empty-glyph">${arch.icon}</div>
      <p>Focus on <strong>${escapeHtml(convo.name)}</strong> is open.</p>
      <p class="empty-hint">${
        isAiNode(convo)
          ? "AI nodes start with Alignment Reveal. Speak about the node → stars densen → Cast Spell consolidates atlas + ready stack. Spells panel only."
          : "Talk about them — Grimoire remembers eternally. Cast Spell consolidates intel into messages <em>or</em> action-spells (sweeping the floor is a cleaning spell)."
      }</p>
    `;
    els.chatMessages.appendChild(empty);
    return;
  }

  convo.messages.forEach((m) => {
    // Suppress legacy junk: auto-discovery + inline spell cards (spells = panel only)
    if (m.kind === "focus-suggestion") return;
    if (m.role === "spell") return;
    els.chatMessages.appendChild(renderMessage(m));
  });

  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function renderMessage(m) {
  const div = document.createElement("div");
  if (m.role === "user") {
    div.className = "message user";
  } else if (m.role === "grimoire") {
    div.className = "message grimoire";
  } else {
    div.className = "message system";
  }
  const roleLabel =
    m.role === "user" ? "You" : m.role === "grimoire" ? "Grimoire" : "System";
  const msgId = m.id || "";

  const imagesHtml = (Array.isArray(m.images) && m.images.length)
    ? `<div class="message-images">${m.images.map((src) => `<img src="${escapeAttr(src)}" alt="Pasted image" loading="lazy" />`).join("")}</div>`
    : "";

  div.innerHTML = `
    <div class="message-header message-role">${roleLabel}</div>
    <div class="message-row">
      <div class="message-body">${imagesHtml}${formatMessageHtml(m.text)}</div>
    </div>
    <button type="button" class="copy-btn btn-copy-msg" data-msg-id="${escapeAttr(msgId)}" title="Copy message">Copy</button>
  `;
  return div;
}

const MAX_IMAGES_PER_SEND = 9;
const IMG_MAX_DIM = 768;
const IMG_JPEG_QUALITY = 0.72;

/**
 * Compress an image File → small base64 data URL (~50KB).
 * Keeps the eternal store (localStorage) healthy: hundreds of captures, not 3.
 */
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, IMG_MAX_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", IMG_JPEG_QUALITY));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error("Could not load pasted image"));
    };
    img.src = blobUrl;
  });
}

async function queuePastedImages(files) {
  const convo = activeConvo();
  if (!convo) return;
  convo.pendingImages = convo.pendingImages || [];

  const room = MAX_IMAGES_PER_SEND - convo.pendingImages.length;
  if (room <= 0) {
    toast(`Max ${MAX_IMAGES_PER_SEND} images per send — send these first`, "");
    return;
  }

  const batch = files.slice(0, room);
  if (files.length > room) {
    toast(`Only ${room} more image${room === 1 ? "" : "s"} fit this send (cap ${MAX_IMAGES_PER_SEND})`, "");
  }

  for (const file of batch) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const dataUrl = await compressImageFile(file);
      convo.pendingImages.push({ url: dataUrl, name: file.name || "pasted", type: "image/jpeg" });
    } catch {
      toast("One image failed to process", "");
    }
  }
  updateAttachButtonState();
  renderPendingImages();
}

function renderPendingImages() {
  const strip = document.getElementById("pending-images");
  if (!strip) return;
  const convo = activeConvo();
  const imgs = convo?.pendingImages || [];
  if (!imgs.length) {
    strip.hidden = true;
    strip.innerHTML = "";
    return;
  }
  strip.hidden = false;
  strip.innerHTML = imgs
    .map(
      (i, idx) => `
      <div class="pending-thumb">
        <img src="${escapeAttr(i.url)}" alt="Pending image ${idx + 1}" />
        <button type="button" class="pending-thumb-remove" data-idx="${idx}" title="Remove image">✕</button>
      </div>`
    )
    .join("");
  strip.querySelectorAll(".pending-thumb-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      const c = activeConvo();
      if (!c?.pendingImages) return;
      c.pendingImages.splice(idx, 1);
      updateAttachButtonState();
      renderPendingImages();
    });
  });
}

function updateAttachButtonState() {
  const convo = activeConvo();
  if (!els.btnAttach) return;
  const n = convo?.pendingImages?.length || 0;
  els.btnAttach.textContent = n ? `📎${n}` : "📎";
  els.btnAttach.title = n ? `${n}/${MAX_IMAGES_PER_SEND} pending — click to clear all` : "Paste images into the input (up to 9 per send)";
}

function clearPendingImages() {
  const convo = activeConvo();
  if (!convo) return;
  convo.pendingImages = [];
  updateAttachButtonState();
  renderPendingImages();
}

function takePendingImagesForSend() {
  const convo = activeConvo();
  const items = convo?.pendingImages || [];
  if (convo) convo.pendingImages = [];
  updateAttachButtonState();
  renderPendingImages();
  return items.map((i) => i.url);
}

// ─── Render: spells panel ───

function renderSpells() {
  const convo = activeConvo();
  // Self-heal: drop junk receipt/echo cards so the panel stays cast-ready
  if (convo) stripReceiptSpells(convo.id);
  const list = convo ? spellsFor(convo.id) : [];
  const pending = convo ? pendingCount(convo.id) : 0;
  const total = list.length;

  // Sidebar / header spell count for active Focus
  const countEl =
    els.spellCount || document.getElementById("spell-count");
  if (countEl) {
    const n = pending > 0 ? pending : total;
    countEl.textContent = n > 0 ? String(n) : "";
    countEl.dataset.count = String(n);
  }

  // Reset clear-all confirm UI on re-render (unless mid-confirm — clear that timer)
  resetClearAllButton();

  if (!convo) {
    els.spellsList.innerHTML = `<div class="spells-empty">Select a focus to see its spells.</div>`;
    if (els.btnClearAll) els.btnClearAll.disabled = true;
    return;
  }

  if (els.btnClearAll) els.btnClearAll.disabled = list.length === 0;

  if (!list.length) {
    els.spellsList.innerHTML = `<div class="spells-empty">No spells yet.<br/>${
      isAiNode(convo)
        ? "Cast Spell for <strong>Alignment Reveal</strong>, or state intent in chat."
        : "Talk to Grimoire — clear intent auto-casts a spell."
    }</div>`;
    return;
  }

  els.spellsList.innerHTML = "";
  list.forEach((spell) => {
    const item = document.createElement("article");
    item.className = "spell-item";
    item.dataset.spellId = spell.id;
    const md = formatSpellMarkdown(spell);
    const badgeClass = spell.rebuilt
      ? "status-badge rebuilt"
      : `status-badge ${spell.status || "ready"}`;
    const badgeText = spell.rebuilt
      ? "REBUILT"
      : escapeHtml(spell.status || "ready");
    item.innerHTML = `
      <button type="button" class="delete-btn" data-action="delete" title="Delete spell">✕</button>
      <div class="spell-item-top">
        <div>
          <div class="spell-item-title">${escapeHtml(spell.purpose)}</div>
          <div class="spell-item-meta">${escapeHtml(spell.medium)} · ${escapeHtml(spellKindKey(spell))}${
            spell.engineeredFromAlignment ? " · aligned" : ""
          }${isAlignmentSpell(spell) ? " · reveal" : ""}</div>
        </div>
        <span class="${badgeClass}">${badgeText}</span>
      </div>
      <p class="spell-essence">${escapeHtml(spell.essence)}</p>
      <div class="spell-actions">
        <button type="button" class="btn-spell copy" data-action="copy">Copy</button>
        ${
          spell.status !== "sent"
            ? `<button type="button" class="btn-spell mark-sent" data-action="sent">Mark Sent</button>`
            : ""
        }
        <button type="button" class="btn-spell expand" data-action="expand">View</button>
      </div>
      <pre class="spell-full">${escapeHtml(md)}</pre>
    `;
    item
      .querySelector('[data-action="copy"]')
      .addEventListener("click", () => copySpell(spell.id));
    item
      .querySelector('[data-action="sent"]')
      ?.addEventListener("click", () => markSent(spell.id));
    item.querySelector('[data-action="expand"]').addEventListener("click", () => {
      item.classList.toggle("expanded");
      const btn = item.querySelector('[data-action="expand"]');
      btn.textContent = item.classList.contains("expanded") ? "Hide" : "View";
    });
    item.querySelector('[data-action="delete"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      requestDeleteSpell(spell.id, e.currentTarget);
    });
    els.spellsList.appendChild(item);
  });
}

/**
 * Two-tap delete for a single spell.
 * First tap: arm (red pulse). Second within 3s: delete.
 */
function requestDeleteSpell(spellId, btnEl) {
  if (!spellId) return;

  if (pendingDeletes.has(spellId)) {
    // Second tap — confirm delete
    clearTimeout(pendingDeletes.get(spellId));
    pendingDeletes.delete(spellId);
    deleteSpell(spellId);
    return;
  }

  // First tap — arm
  btnEl?.classList.add("confirming");
  if (btnEl) btnEl.title = "Tap again to delete";
  toast("Tap again to delete", "");

  const t = setTimeout(() => {
    pendingDeletes.delete(spellId);
    btnEl?.classList.remove("confirming");
    if (btnEl) btnEl.title = "Delete spell";
  }, DELETE_CONFIRM_MS);
  pendingDeletes.set(spellId, t);
}

/**
 * Remove one spell from the book + chat spell cards for this Focus.
 */
function deleteSpell(spellId) {
  const spell = state.spells.find((s) => s.id === spellId);
  if (!spell) return;
  const focusId = spell.conversationId;

  state.spells = state.spells.filter((s) => s.id !== spellId);

  // Strip chat messages that embedded this spell card
  for (const c of state.conversations) {
    if (c.id !== focusId) continue;
    c.messages = (c.messages || []).filter(
      (m) => !(m.role === "spell" && m.spellId === spellId)
    );
  }

  persist();
  renderAll();
  notifyConstellation(focusId, "standard");

  const focus = state.conversations.find((c) => c.id === focusId);
  if (focus) syncFocusIntelligenceFile(focus);

  toast("Spell deleted", "success");
}

/**
 * Two-tap clear-all for current Focus only.
 */
function requestClearAllSpells() {
  const convo = activeConvo();
  if (!convo) return;
  const list = spellsFor(convo.id);
  if (!list.length) {
    toast("No spells to clear", "");
    return;
  }

  const key = "clear-all";
  const btn = els.btnClearAll;

  if (pendingDeletes.has(key)) {
    clearTimeout(pendingDeletes.get(key));
    pendingDeletes.delete(key);
    clearAllSpellsForFocus(convo.id);
    resetClearAllButton();
    return;
  }

  if (btn) {
    btn.classList.add("confirming");
    btn.textContent = "CONFIRM CLEAR ALL?";
    btn.title = "Tap again to wipe all spells for this focus";
  }
  toast("Tap again to confirm", "");

  const t = setTimeout(() => {
    pendingDeletes.delete(key);
    resetClearAllButton();
  }, DELETE_CONFIRM_MS);
  pendingDeletes.set(key, t);
}

function resetClearAllButton() {
  if (pendingDeletes.has("clear-all")) {
    clearTimeout(pendingDeletes.get("clear-all"));
    pendingDeletes.delete("clear-all");
  }
  if (els.btnClearAll) {
    els.btnClearAll.classList.remove("confirming");
    els.btnClearAll.textContent = "Clear All";
    els.btnClearAll.title = "Clear all spells for this focus";
  }
}

function clearAllSpellsForFocus(focusId) {
  const ids = new Set(
    state.spells.filter((s) => s.conversationId === focusId).map((s) => s.id)
  );
  state.spells = state.spells.filter((s) => s.conversationId !== focusId);

  const focus = state.conversations.find((c) => c.id === focusId);
  if (focus) {
    focus.messages = (focus.messages || []).filter(
      (m) => !(m.role === "spell" && ids.has(m.spellId))
    );
  }

  persist();
  renderAll();
  notifyConstellation(focusId, "standard");
  if (focus) syncFocusIntelligenceFile(focus);

  toast("All spells cleared", "success");
}

// ─── Render: constellation (living intelligence map) ───

/**
 * Derive per-Focus metrics from real spellbooks + chat.
 * Background densifies with spellCount / alignment / entities mentioned.
 */
function buildFocusMetricsMap() {
  const map = {};
  for (const c of state.conversations) {
    const spells = state.spells.filter((s) => s.conversationId === c.id);
    const spellTypes = spells.map((s) => {
      if (isAlignmentSpell(s) || s.kind === "alignment") return "reveal";
      const t = getFocusType(c);
      if (t === "person") return "person";
      if (t === "network") return "network";
      return "ai";
    });
    // Entities mentioned: unique proper-ish tokens in user messages (light)
    const mentioned = new Set();
    for (const m of c.messages || []) {
      if (m.role !== "user" || !m.text) continue;
      const caps = m.text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) || [];
      for (const cap of caps) {
        if (cap.toLowerCase() === c.name.toLowerCase()) continue;
        mentioned.add(cap.toLowerCase());
      }
    }
    // alignmentRevealed = paste received (not merely "Alignment Reveal" spell cast)
    const alignLocked = Boolean(
      c.alignmentRevealed || c.alignmentReceived || c.alignmentNotes
    );
    // Each past user message = one intelligence capture (restores growth after reload)
    const userCaptures = (c.messages || []).filter((m) => m.role === "user").length;
    map[c.id] = {
      spellCount: spells.length,
      alignmentRevealed: alignLocked,
      entitiesMentioned: Math.max(mentioned.size, userCaptures),
      intelBits: userCaptures,
      spellTypes,
      lastActive: c.id === state.activeId ? Date.now() : 0,
      type: getFocusType(c),
      name: c.name,
    };
    setFocusMetrics(c.id, map[c.id]);
  }
  return map;
}

/** Sync canvas universe from active Focus state (deterministic rebuild path). */
function renderStars(opts = {}) {
  const convo = activeConvo();
  const snap = deriveFocusSnapshot(convo, state.spells);
  // Default: soft rebuild, no warp (warp only on explicit focus switch)
  setFocusUniverse(snap, { warp: Boolean(opts.warp) });
  if (convo) {
    const metrics = buildFocusMetricsMap()[convo.id];
    if (metrics) setFocusMetrics(convo.id, metrics);
  }
  updateUniverseHudChrome(snap);
}

function updateUniverseHudChrome(snap) {
  const hud = getUniverseHud();
  const stageName = hud.stageName || snap?.stageName || "VOID";
  const starCount = hud.starCount || 0;
  const convo = activeConvo();
  const health = convo ? computeFocusHealth(convo, state.spells) : null;
  if (els.universeHudCount) els.universeHudCount.textContent = String(starCount);
  if (els.universeHudStage) {
    const hpBit = health ? ` · ${healthHudChip(health)}` : "";
    els.universeHudStage.textContent = `${stageName}${hpBit}`;
  }
  if (els.universeHud) {
    els.universeHud.title = health
      ? `${health.summary} — click for Intel Atlas / Healer health`
      : "Intel Atlas";
    els.universeHud.dataset.healthBand = health?.band || "";
  }
  if (els.universeStage) {
    const ch = snap?.focusId && convo ? `${getSealedChannel(convo)}` : "";
    els.universeStage.textContent = snap?.focusId
      ? `${stageName}${health ? ` · HP ${health.hp}` : ""}${ch ? "" : ""}`
      : "VOID";
  }
}

/**
 * After spell creation / focus switch — grow the living map for this Focus.
 */
function notifyConstellation(focusId, spellType) {
  const metrics = buildFocusMetricsMap()[focusId] || {
    spellCount: 0,
    alignmentRevealed: false,
  };
  updateConstellation(focusId, metrics.spellCount || 0, {
    ...metrics,
    alignmentRevealed:
      Boolean(metrics.alignmentRevealed) || spellType === "reveal",
  });
  if (spellType === "reveal" || metrics.alignmentRevealed) {
    universeEvent("align", {
      directives: activeConvo()?.alignmentProfile?.directives?.length || 0,
    });
  } else {
    universeEvent("spell");
  }
  renderStars({ warp: false });
}

function spellTypeForFocus(convo, spell) {
  if (isAlignmentSpell(spell) || spell?.kind === "alignment") return "reveal";
  const t = getFocusType(convo);
  if (t === "person") return "person";
  if (t === "network") return "network";
  return "ai";
}

function renderAll() {
  els.app.classList.toggle("spells-collapsed", !state.spellsOpen);
  renderConvoList();
  renderChat();
  renderSpells();
  renderStars();
  updateAttachButtonState();
  renderPendingImages();
  if (els.universeLegend && !els.universeLegend.hasAttribute("hidden")) {
    renderIntelAtlas(activeConvo());
  }
}

// ─── Actions ───

function selectConvo(id) {
  if (state.activeId === id) return;
  state.activeId = id;
  const convo = activeConvo();
  if (convo) ensureAlignmentDirective(convo);
  persist();
  // Warp to this Focus's universe
  const snap = deriveFocusSnapshot(convo, state.spells);
  setFocusUniverse(snap, { warp: true });
  renderAll();
  updateUniverseHudChrome(snap);
}

/**
 * AI nodes always get the alignment-reveal directive as first Grimoire message.
 */
function ensureAlignmentDirective(convo) {
  if (!isAiNode(convo)) return false;
  if (hasAlignmentDirective(convo)) return false;
  const ch = getSealedChannel(convo);
  convo.messages = convo.messages || [];
  convo.messages.unshift({
    id: uid("msg"),
    role: "grimoire",
    text: `Sealed channel: **${convo.name} · ${ch}**. **Focus-first gate:** Cast Spell to generate Alignment Reveal. Send their reply here to unlock spellcraft.`,
    ts: Date.now(),
    kind: "alignment-directive",
  });
  return true;
}

function sendMessage(text) {
  const convo = activeConvo();
  if (!convo || (!text || !text.trim())) return;

  const userText = (text || "").trim();

  // === PULSE PROTOCOL (Focus-specific only; no multi-entity, no cross-write) ===
  if (isPulse(userText)) {
    if (convo.pulseCount == null) convo.pulseCount = 0;
    if (convo.pendingPulseAction === undefined) convo.pendingPulseAction = null;
    convo.pulseCount = (convo.pulseCount || 0) + 1;
    convo.lastPulseAt = Date.now();
    const pulseIndex = convo.pulseCount;

    // User mark stays on this Focus only
    convo.messages.push({
      id: uid("msg"),
      role: "user",
      text: ".",
      images: takePendingImagesForSend(),
      ts: Date.now(),
      kind: "pulse",
    });

    const pulseMsg = buildPulseReply(convo, pulseIndex);
    convo.messages.push({
      id: uid("msg"),
      role: "grimoire",
      text: pulseMsg,
      ts: Date.now(),
      kind: "pulse-reply",
    });

    // Pulse → radial ripple across this Focus universe
    densenConstellationFromIntel(convo, 1);
    universeEvent("pulse", {
      spellsSent: spellsFor(convo.id).filter((s) => s.status === "sent").length,
    });

    persist();
    renderChat();
    renderConvoList();
    renderSpells();
    return;
  }

  ensureAlignmentDirective(convo);

  const sentImages = takePendingImagesForSend();
  convo.messages.push({
    id: uid("msg"),
    role: "user",
    text: userText,
    images: sentImages,
    ts: Date.now(),
  });

  // Each image = nebula bloom + intel stars
  if (sentImages.length) {
    densenConstellationFromIntel(convo, sentImages.length);
    universeEvent("image", { count: sentImages.length });
    syncFocusIntelligenceFile(
      convo,
      "VISUAL_INTEL",
      `${sentImages.length} image${sentImages.length === 1 ? "" : "s"} captured as focus intelligence${userText ? ` — context: ${userText.slice(0, 300)}` : ""}`
    );
  }

  const medium = syncMediumFromControls(convo);

  // Continuous intelligence ingest + panel-only spell auto-forge (AI Focus)
  const ingested = ingestIntelligence(convo, userText);

  // Grimoire turn: text in chat; spells only via generateAndStoreSpell → panel
  let turn;
  if (ingested?.alignmentJustLocked) {
    const n = convo.alignmentProfile?.directives?.length || 0;
    const sig = convo.alignmentProfile?.signal;
    turn = {
      reply: [
        `**Alignment locked** for **${convo.name} · ${getSealedChannel(convo)}**.`,
        n
          ? `Extracted **${n}** operational directives from the reveal.`
          : `Reveal stored — spellcraft unlocked.`,
        sig != null ? `Signal on file: **${sig}/10**.` : "",
        `Intelligence written to vault. Constellation densened. Ask for a spell — engineered against this alignment, not a receipt.`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  } else {
    turn = grimoireReply(convo, userText);
  }

  if (turn.reply) {
    convo.messages.push({
      id: uid("msg"),
      role: "grimoire",
      text: turn.reply,
      ts: Date.now(),
    });
  }

  // Auto-forge after every user turn, before persist.
  // AI Nodes always have at least 1 spell: Alignment Reveal if missing,
  // otherwise directives from alignment profile when intent/support exists.
  // Person/Network auto-forge on clear intent or supported general context.
  forgeAfterUserTurn(convo, userText, turn?.reply);

  persist();
  renderChat();
  renderConvoList();
  renderSpells();
}

/**
 * After every user message in an AI Focus:
 * - append timestamped content to <FocusName>.md in vault
 * - set alignmentRevealed if message contains Signal / Alignment: / Essence: / Capabilities:
 * - parse profile for engineered spells
 * - densen constellation (+6 stars per capture, grow forever)
 */
function ingestIntelligence(convo, userText) {
  if (!convo || !userText?.trim()) return null;
  if (!isAiNode(convo)) {
    // Still log person/network notes lightly without gate
    if (userText.trim().length > 40) {
      syncFocusIntelligenceFile(
        convo,
        "USER_NOTE",
        userText.trim().slice(0, 2000)
      );
      densenConstellationFromIntel(convo, 1);
    }
    return { alignmentJustLocked: false };
  }

  const text = userText.trim();
  const wasUnlocked = convoAlignmentUnlocked(convo);

  // GBG: alignment if message contains Signal, Alignment:, Essence:, Capabilities:
  const looksLikeReveal =
    /\bSignal\b/i.test(text) ||
    /\bAlignment\s*:/i.test(text) ||
    /\bEssence\s*:/i.test(text) ||
    /\bCapabilities\s*:/i.test(text) ||
    (convoHasAlignmentSpell(convo) &&
      text.length > 160 &&
      /\b(constraint|capability|purpose|doctrine|lane)\b/i.test(text));

  if (looksLikeReveal) {
    convo.alignmentNotes = text.slice(0, 8000);
    convo.alignmentReceived = true;
    convo.alignmentRevealed = true;
    convo.alignmentProfile = parseAlignmentIntelligence(text);
    // Strip legacy receipt cards before any real engineered spells land
    stripReceiptSpells(convo.id);
  }

  // Always append user intel to vault for AI focuses
  const eventType = looksLikeReveal ? "ALIGNMENT_REPLY" : "INTELLIGENCE";
  const dirs = convo.alignmentProfile?.directives || [];
  const content = looksLikeReveal
    ? [
        "Parsed alignment intelligence:",
        ...dirs.map((d) => `- ${d}`),
        "",
        text.slice(0, 4000),
      ].join("\n")
    : text.slice(0, 2000);

  // Visible growth first — universe reacts while vault writes
  const justLocked = looksLikeReveal && !wasUnlocked;
  const growth = densenConstellationFromIntel(convo, 1, {
    alignmentLock: justLocked || looksLikeReveal,
    justLocked,
  });

  if (justLocked || looksLikeReveal) {
    universeEvent("align", {
      directives: convo.alignmentProfile?.directives?.length || 0,
      spellsSent: spellsFor(convo.id).filter((s) => s.status === "sent").length,
    });
  } else {
    universeEvent("intel", { count: 1 });
  }

  // Soft-sync full universe from state (deterministic counts)
  setFocusUniverse(deriveFocusSnapshot(convo, state.spells), { warp: false });

  // Vault write + activity ping (async; constellation already animated)
  syncFocusIntelligenceFile(convo, eventType, content, {
    starsAdded: growth?.starsAdded || 6,
  });

  return {
    alignmentJustLocked: justLocked,
    bits: 1,
    starsAdded: growth?.starsAdded || 0,
  };
}

/**
 * Visible constellation growth — live stars animate in immediately.
 * @returns {{ starsAdded: number, alignmentLock: boolean }}
 */
function densenConstellationFromIntel(convo, captures = 1, opts = {}) {
  if (!convo) return { starsAdded: 0, alignmentLock: false };
  const n = Math.max(1, captures | 0);
  const spellCount = spellsFor(convo.id).length;
  const alignmentLock =
    Boolean(opts.alignmentLock) ||
    (Boolean(opts.justLocked) && convoAlignmentUnlocked(convo));

  updateConstellation(convo.id, spellCount, {
    spellCount,
    alignmentRevealed: convoAlignmentUnlocked(convo) || alignmentLock,
    name: convo.name,
    type: getFocusType(convo),
  });

  const growth = liveCapture(convo.id, {
    captures: n,
    alignmentLock,
  });

  // Canvas universe: live celestial growth
  if (alignmentLock) {
    universeEvent("align", {
      directives: convo.alignmentProfile?.directives?.length || 0,
    });
  } else {
    universeEvent("intel", { count: n });
  }
  setFocusUniverse(deriveFocusSnapshot(convo, state.spells), { warp: false });
  updateUniverseHudChrome(deriveFocusSnapshot(convo, state.spells));

  return {
    starsAdded: growth?.starsAdded || n * 6,
    alignmentLock,
  };
}

/**
 * Auto-forge a spell after each user turn.
 * AI: Alignment Reveal only until locked; after lock NEVER another reveal —
 * only engineered directives. Person/Network: intent-driven.
 */
/**
 * Node reply that is intel-to-ingest, NOT a new outbound forge request.
 * Pasting ACKs / status tables was flooding spells with garbage cards.
 */
function isInboundNodeIntel(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  // User is designating a forward lane/action → evidence = forge request, not receipt
  if (
    /\b(advance to|execute move|designate|order|dispatch|disperse|run the|forge me|give me a spell|craft a|send this|next shift is)\b/i.test(
      t
    )
  ) {
    return false;
  }
  // Classic node reply shapes
  if (
    /^(SPELL RECEIVED|FRAME HOLDING|SPELL DUPLICATE DETECTED|CONSTELLATION READ|TRANSPARENCY|ACTION TAKEN|CONFIRMED\.|MOVE \d|NEXT THREE MOVES|CURRENT STATE|OVERALL:|SIGNAL:)/im.test(
      t
    )
  ) {
    return true;
  }
  if (/\b(Pulse:\s*\.|Signal:\s*\d+\/10|EVIDENCE:|NEXT THREE MOVES|ACTION TAKEN|FRAME HOLDING|ALREADY FORGED|NO CHANGE SINCE LAST ACK)\b/i.test(t)) {
    return true;
  }
  // Markdown status tables from nodes
  if (/^\|.+\|[\s\S]*\|----/m.test(t) && /(LOCK|ACTIVE|PENDING|EXECUTED|MOVE)/i.test(t)) {
    return true;
  }
  return false;
}

function forgeAfterUserTurn(convo, userText, turnReply) {
  if (!convo) return null;
  const text = String(userText || "").trim();
  const medium = syncMediumFromControls(convo);
  const alignmentUnlocked = convoAlignmentUnlocked(convo);
  const hasAlignmentSpell = convoHasAlignmentSpell(convo);

  // INTEL INGEST ≠ SPELL FORGE. Vault + constellation still densen outside this gate.
  // Inbound node ACKs/status only auto-forge pre-alignment (capture the reveal itself).
  if (alignmentUnlocked && isInboundNodeIntel(text)) {
    return null;
  }

  if (isAiNode(convo)) {
    // Pre-alignment only: ensure ONE Alignment Reveal exists
    if (!alignmentUnlocked) {
      if (!hasAlignmentSpell) {
        const spell = generateAlignmentSpell(convo, medium);
        commitSpell(convo, spell, { silentToast: true });
        return spell;
      }
      const intentish =
        hasSpellIntent(text) ||
        /\b(align|reveal|signal|essence|capabilities|constraints|purpose|who are you|what can you)\b/i.test(
          text
        );
      // Rebuild (dedupe upgrades) the same reveal card — never a second reveal
      if (intentish) {
        const spell = generateAlignmentSpell(convo, medium);
        commitSpell(convo, spell, { silentToast: true });
        return spell;
      }
      return null;
    }

    // Post-alignment: forge ONLY when the user asks for a real outbound directive.
    // Length >= 80 was churning every pasted ACK into a card — REMOVED.
    // Lower-gate "always forge if directives exist" — REMOVED (source of spam).
    const intent =
      hasSpellIntent(text) ||
      /\b(spell|directive|send|broadcast|execute|tell|instruct|message|post|craft|forge|cast|deliver|whisper|transmit|deploy|dispatch|write|draft|command|order|advance|designate)\b/i.test(
        text
      );

    if (!intent) return null;

    if (convo.alignmentNotes && !convo.alignmentProfile) {
      convo.alignmentProfile = parseAlignmentIntelligence(convo.alignmentNotes);
    }
    const spell = generateSpell(convo, medium, text, {
      allSpells: state.spells,
    });
    // Safety: never commit a reveal after lock
    if (isAlignmentSpell(spell)) return null;
    // Never store pure receipt titles
    if (isReceiptSpell(spell)) return null;
    commitSpell(convo, spell, { silentToast: true });
    return spell;
  }

  if (isPerson(convo) || isNetwork(convo)) {
    if (isInboundNodeIntel(text)) return null;
    const intent =
      hasSpellIntent(text) ||
      /\b(spell|message|reply|note|draft|send|tell|follow up|reach out|next move)\b/i.test(
        text
      );

    if (!intent) {
      return null;
    }

    const spell = generateSpell(convo, medium, text, {
      allSpells: state.spells,
    });
    if (isReceiptSpell(spell)) return null;
    commitSpell(convo, spell, { silentToast: true });
    return spell;
  }

  return null;
}

/**
 * Ensure AI Node always has a base spell, while avoiding duplicates.
 * Uses the same panel-only store path as manual Cast Spell.
 */
function ensureBaseSpell(convo) {
  if (!convo || !isAiNode(convo)) return null;
  if (convoHasAlignmentSpell(convo)) return null;
  const medium = syncMediumFromControls(convo);
  const spell = generateAlignmentSpell(convo, medium);
  commitSpell(convo, spell, { silentToast: true });
  return spell;
}

/**
 * "+ New Focus" — open dialog, focus name field.
 * Form submit → createConversation + close (see newForm listener).
 */
function showNewFocusModal(opts = {}) {
  openNewFocusModal(opts);
}

/** Manual only: "+ New Focus" in sidebar. No mid-chat auto-discovery. */
function openNewFocusModal({ name, archetype, medium, type, aiSubtype, channel } = {}) {
  if (!els.dialog || !els.newName) {
    console.warn("New Focus dialog missing from DOM");
    return;
  }

  els.newName.value = name || "";

  let t = type;
  if (!t) {
    if (archetype === "network") t = "network";
    else if (archetype === "person") t = "person";
    else if (archetype && ["wizard", "sage", "knight"].includes(archetype)) t = "ai";
    else if (medium && AI_SUBTYPES[medium]) t = "ai";
    else if (medium === "LinkedIn" && /network/i.test(name || "")) t = "network";
    else t = "person";
  }

  if (els.newType) els.newType.value = t;
  syncNewFocusModalFields();

  if (t === "ai") {
    const sub =
      aiSubtype ||
      (medium && AI_SUBTYPES[medium] ? medium : null) ||
      "Hermes";
    if (els.newAiSubtype) {
      els.newAiSubtype.value = AI_SUBTYPES[sub] ? sub : "Hermes";
    }
  } else if (t === "network") {
    fillNewChannelOptions("network", channel || medium || "LinkedIn");
  } else {
    fillNewChannelOptions("person", channel || medium || "Discord");
  }

  try {
    els.dialog.showModal();
  } catch (err) {
    // Fallback if already open or non-modal browsers
    if (typeof els.dialog.show === "function") els.dialog.show();
    else els.dialog.setAttribute("open", "");
  }
  els.newName.focus();
  els.newName.select();
}

function syncNewFocusModalFields() {
  const t = els.newType?.value || "person";
  if (t === "ai") {
    if (els.newAiSubtypeLabel) els.newAiSubtypeLabel.hidden = false;
    if (els.newChannelLabel) els.newChannelLabel.hidden = true;
  } else {
    if (els.newAiSubtypeLabel) els.newAiSubtypeLabel.hidden = true;
    if (els.newChannelLabel) els.newChannelLabel.hidden = false;
    // Update platform vs medium label
    if (els.newChannelLabel) {
      els.newChannelLabel.childNodes[0].textContent =
        t === "network" ? "Platform\n        " : "Medium\n        ";
    }
    fillNewChannelOptions(t, els.newChannel?.value);
  }
}

/** @deprecated — ingestIntelligence is the single path */
function maybeCaptureAlignmentNotes(convo, userText) {
  const r = ingestIntelligence(convo, userText);
  return Boolean(r?.alignmentJustLocked || convo?.alignmentReceived);
}

/**
 * Channel purity — deny off-topic entities mid-exchange.
 * Never auto-creates focuses. Never wanders.
 */
function detectChannelViolation(convo, userText) {
  const text = (userText || "").trim();
  if (!text || !convo) return null;

  const currentName = (convo.name || "").toLowerCase();
  const currentChannel = getSealedChannel(convo).toLowerCase();

  // Other sealed focuses by full name
  for (const f of state.conversations) {
    if (f.id === convo.id) continue;
    const n = (f.name || "").trim();
    if (n.length < 3) continue;
    if (n.toLowerCase() === currentName) {
      // Same name, different backend — "Wizard King on Grok"
      const ch = getSealedChannel(f);
      const re = new RegExp(
        `\\b${escapeRegExp(n)}\\b.{0,24}\\b(?:on|via|through)\\s+${escapeRegExp(ch)}\\b`,
        "i"
      );
      if (re.test(text) || new RegExp(`\\b${escapeRegExp(ch)}\\b`, "i").test(text) &&
          new RegExp(`\\b${escapeRegExp(n)}\\b`, "i").test(text) &&
          ch.toLowerCase() !== currentChannel) {
        // Only flag if they clearly mean another channel of same name
        if (
          new RegExp(`\\b(?:on|via|through)\\s+${escapeRegExp(ch)}\\b`, "i").test(text)
        ) {
          return `${n} · ${ch}`;
        }
      }
      continue;
    }
    const re = new RegExp(`\\b${escapeRegExp(n)}\\b`, "i");
    if (re.test(text)) {
      // Require active channel-framing verbs; bare name mention is not a violation.
      if (
        new RegExp(
          `\\b(?:talk(?:ing)?\\s+to|message|ask|tell|focus|open|about|with|for)\\s+${escapeRegExp(n)}\\b`,
          "i"
        ).test(text) ||
        new RegExp(`\\b${escapeRegExp(n)}\\b.{0,12}\\b(?:on|via|channel|focus)\\b`, "i").test(
          text
        )
      ) {
        return `${n} · ${getSealedChannel(f)}`;
      }
    }
  }

  // Explicit "on <other backend>" while locked to a different AI channel
  if (getFocusType(convo) === "ai") {
    for (const be of Object.keys(AI_SUBTYPES)) {
      if (be.toLowerCase() === currentChannel) continue;
      if (
        new RegExp(
          `\\b(?:on|via|through|switch\\s+to|use)\\s+${escapeRegExp(be)}\\b`,
          "i"
        ).test(text)
      ) {
        return `${convo.name} · ${be}`;
      }
    }
  }

  return null;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Core Grimoire intelligence for this turn.
 * Returns { reply, spell? } — spell is auto-generated when intent is clear.
 * Does not wait for Cast Spell — Grimoire initiates.
 */
function grimoireReply(convo, userText) {
  const medium = syncMediumFromControls(convo);

  // CHANNEL PURITY — deny off-topic before any spellcraft
  const violation = detectChannelViolation(convo, userText);
  if (violation) {
    return {
      reply: `That's outside this channel (**${convo.name} · ${medium}**). Open a new Focus to work with **${violation}**. I stay locked here — no auto-create, no wander.`,
    };
  }

  if (isAiNode(convo)) {
    return grimoireReplyAiNode(convo, userText, medium);
  }
  return grimoireReplyPersonOrNetwork(convo, userText, medium);
}

/**
 * Generate spell + store in state.spells + Spells panel only.
 * NEVER injects spell cards into chat.
 * Used by intent detection and Cast Spell button.
 */
/**
 * FOCUS-FIRST GATE (AI):
 * 1) No alignment spell yet → only Alignment Reveal
 * 2) !alignmentRevealed → block engineered craft ("Lock alignment first.")
 * 3) alignmentRevealed → engineer from parsed capabilities/constraints/frames
 * Spells render in Spells panel only.
 */
function generateAndStoreSpell(convo, userText = "", { silentToast = false } = {}) {
  if (!convo) return null;
  const medium = syncMediumFromControls(convo);

  if (isAiNode(convo)) {
    const unlocked = convoAlignmentUnlocked(convo);
    // Once alignment is locked — NEVER auto-forge another Alignment Reveal
    if (!unlocked) {
      if (!convoHasAlignmentSpell(convo)) {
        const spell = generateAlignmentSpell(convo, medium);
        commitSpell(convo, spell, { silentToast });
        return spell;
      }
      return { blocked: true, reason: "Lock alignment first." };
    }
  }

  // Engineered against alignment profile (not a receipt / not another reveal)
  if (convo.alignmentNotes && !convo.alignmentProfile) {
    convo.alignmentProfile = parseAlignmentIntelligence(convo.alignmentNotes);
  }

  const spell = generateSpell(convo, medium, userText || "", {
    allSpells: state.spells,
  });
  if (isAiNode(convo) && isAlignmentSpell(spell) && convoAlignmentUnlocked(convo)) {
    return { blocked: true, reason: "Alignment already locked — request a directive spell." };
  }
  commitSpell(convo, spell, { silentToast });
  return spell;
}

/**
 * Conversation + spell generation on intent.
 * Spells go to panel via generateAndStoreSpell — chat gets text only.
 */
function grimoireReplyAiNode(convo, userText, medium) {
  const hasSpell = convoHasAlignmentSpell(convo);
  const unlocked = convoAlignmentUnlocked(convo);
  const intent = hasSpellIntent(userText);
  const seal = `${convo.name} · ${medium}`;

  // Gate 1: no alignment spell yet
  if (!hasSpell) {
    if (intent || /\b(align|reveal|transparency|who are you|what can you)\b/i.test(userText)) {
      const spell = generateAndStoreSpell(convo, userText, { silentToast: true });
      return {
        reply: `**Cast Spell path open.** Alignment Reveal forged for **${seal}**. **Open the Spells panel**, copy it, send to the node, then **paste the full reply here** to unlock engineered spellcraft.`,
        spell,
      };
    }
    return {
      reply: `**Focus-first gate.** Sealed on **${seal}**. Cast Spell to generate **Alignment Reveal**. Send their reply here to unlock spellcraft. No engineered spells until then.`,
    };
  }

  // Gate 2: waiting for paste
  if (!unlocked) {
    if (intent) {
      return {
        reply: `**Lock alignment first.** Paste the node's full Alignment reply here (Signal / Capabilities / Constraints / Essence). Then I engineer real directives — not receipts.`,
      };
    }
    return {
      reply: `Waiting on alignment reply for **${seal}**. Paste their reveal to unlock. Until then: **Lock alignment first.**`,
    };
  }

  // Gate 3: unlocked — engineer from profile
  if (intent) {
    const spell = generateAndStoreSpell(convo, userText, { silentToast: true });
    if (spell?.blocked) {
      return { reply: `**${spell.reason}** Paste alignment reply to unlock spellcraft.` };
    }
    if (!spell || spell.blocked) {
      return {
        reply: `Could not forge yet. Paste or re-paste alignment if the profile is empty, then ask again.`,
      };
    }
    const craft = spell.crafted ? ` ${spell.crafted}.` : "";
    const n =
      spell.alignmentDirectives?.length ||
      convo.alignmentProfile?.directives?.length ||
      0;
    return {
      reply: `**Spell forged: ${spell.purpose}.**${craft}${n ? ` Locked to **${n}** alignment directives.` : ""} **Open Spells panel to copy.**`,
      spell,
    };
  }

  if (/\b(hello|hi|hey)\b/i.test(userText)) {
    return {
      reply: `Sealed + aligned on **${seal}**. State a directive or ask for a spell — I engineer against the reveal, panel only.`,
    };
  }

  const n = convo.alignmentProfile?.directives?.length || 0;
  return {
    reply: `Holding **${seal}** with alignment on file${n ? ` (${n} directives)` : ""}. Ask for a spell when you want an engineered cast.`,
  };
}

/**
 * Person/network: generate on intent, panel-only storage.
 */
function grimoireReplyPersonOrNetwork(convo, userText, medium) {
  const intent = hasSpellIntent(userText);
  const arch = ARCHETYPES[convo.archetype]?.label || "focus target";

  if (intent) {
    const spell = generateAndStoreSpell(convo, userText, { silentToast: true });
    const craft = spell?.crafted ? ` ${spell.crafted}.` : "";
    return {
      reply: `Spell forged: **${spell?.purpose || "message"}**.${craft} **Open the Spells panel to copy.** Chat stays conversation only.`,
      spell,
    };
  }

  if (/\b(hello|hi|hey)\b/i.test(userText)) {
    return {
      reply: `Focus is on **${convo.name}** (${arch} · ${medium}). Tell me what they should receive — say “draft a spell…” or hit **Cast Spell**.`,
    };
  }

  return {
    reply: `Noted for **${convo.name}**. Keep refining. When ready, ask for a spell or hit **Cast Spell** — it lands in the Spells panel only.`,
  };
}

/**
 * Drop legacy "SPELL RECEIVED / SEALED CHANNEL CONFIRMED" receipt cards for a focus.
 */
function stripReceiptSpells(focusId) {
  if (!focusId) return;
  const before = state.spells.length;
  state.spells = state.spells.filter(
    (s) => !(s.conversationId === focusId && isReceiptSpell(s))
  );
  if (state.spells.length !== before) persist();
}

/**
 * Push spell into Spells panel only.
 * Same kind + similar purpose ⇒ UPGRADE existing card in place (REBUILT badge).
 */
function commitSpell(convo, spell, { silentToast = false } = {}) {
  if (!convo || !spell || spell.blocked) return;
  if (isReceiptSpell(spell)) return;

  if (isAlignmentSpell(spell) || convo.alignmentRevealed) {
    stripReceiptSpells(convo.id);
  }

  // Post-alignment: refuse a second Alignment Reveal
  if (
    isAiNode(convo) &&
    isAlignmentSpell(spell) &&
    convoAlignmentUnlocked(convo) &&
    convoHasAlignmentSpell(convo)
  ) {
    return;
  }

  if (!spell.kind) {
    spell.kind = isAlignmentSpell(spell) ? "alignment" : "standard";
  }

  const existing = state.spells.find(
    (s) =>
      s.conversationId === convo.id &&
      (s.id === spell.id || spellsAreSameKindPurpose(s, spell))
  );

  let rebuilt = false;
  if (existing) {
    // Upgrade in place — keep id, refresh body against newest intel
    const keepId = existing.id;
    const prevStatus = existing.status;
    Object.assign(existing, spell, {
      id: keepId,
      conversationId: convo.id,
      createdAt: Date.now(),
      rebuilt: true,
      rebuiltAt: Date.now(),
      status: prevStatus === "sent" ? "ready" : prevStatus || "ready",
    });
    rebuilt = true;
  } else {
    spell.rebuilt = false;
    state.spells.push(spell);
  }

  state.spells = dedupeSpells(state.spells);

  if (!state.spellsOpen) {
    state.spellsOpen = true;
  }

  persist();
  renderSpells();
  renderConvoList();
  const growth = densenConstellationFromIntel(convo, 1, {
    alignmentLock: isAlignmentSpell(spell),
  });
  if (!isAlignmentSpell(spell)) {
    universeEvent("spell");
  }
  notifyConstellation(convo.id, spellTypeForFocus(convo, spell));

  const evType = isAlignmentSpell(spell)
    ? "SPELL_ALIGNMENT"
    : rebuilt
      ? "SPELL_REBUILT"
      : "SPELL_CAST";
  const stored = existing || spell;
  const evBody = [
    `Purpose: ${stored.purpose}`,
    `Medium: ${stored.medium}`,
    `Status: ${stored.status}`,
    rebuilt ? "REBUILT against latest alignment intel" : "",
    stored.crafted || "",
    "",
    formatSpellMarkdown(stored),
  ]
    .filter(Boolean)
    .join("\n");
  syncFocusIntelligenceFile(convo, evType, evBody, {
    starsAdded: growth?.starsAdded || 0,
  });

  if (!silentToast) {
    toast(
      rebuilt
        ? `Spell rebuilt: ${stored.purpose}`
        : isAlignmentSpell(stored)
          ? "Alignment Reveal → Spells panel + vault"
          : "Spell forged → Spells panel + vault",
      "success"
    );
  }
}

/**
 * Persist sealed Focus intelligence to vault on disk.
 * Always surfaces an activity ping; vault fail → amber folder dot.
 */
async function syncFocusIntelligenceFile(
  convo,
  eventType,
  eventContent,
  opts = {}
) {
  if (!convo) return;
  const starsAdded = opts.starsAdded || 0;
  try {
    let result;
    if (eventType) {
      result = await recordFocusEvent(
        convo,
        state.spells,
        eventType,
        eventContent || ""
      );
    } else {
      result = await writeFocusIntelligence(convo, state.spells);
    }
    persist();

    const fileLabel =
      result?.fileName || focusFileName(convo) || `${convo.name}.md`;

    if (result?.method === "filesystem" && result?.ok !== false) {
      setVaultFailState(false);
      const starBit =
        starsAdded > 0 ? `Constellation +${starsAdded} · ` : "";
      activityPing(`✦ ${starBit}Vault written: ${fileLabel}`);
    } else if (result?.method === "no-folder") {
      setVaultFailState(true);
      activityPing(`✦ Vault not linked — click 📁 to capture ${fileLabel}`);
    } else if (result?.method === "download") {
      setVaultFailState(false);
      activityPing(`✦ Saved via download: ${fileLabel}`);
    } else if (result?.method === "error" || result?.ok === false) {
      setVaultFailState(true);
      activityPing(`✦ Vault write failed — click 📁 to re-link`);
    }
  } catch (err) {
    console.warn("Intelligence sync failed", err);
    setVaultFailState(true);
    activityPing(`✦ Vault write failed — click 📁 to re-link`);
  }
}

async function refreshIntelFolderUi() {
  const label = await getFolderLabel();
  if (!els.intelFolderStatus || !els.btnIntelFolder) return;
  if (label && isIntelligenceSetupComplete()) {
    els.intelFolderStatus.textContent = `Vault → ${label}/`;
    els.intelFolderStatus.className = "intel-folder-status ready";
    els.btnIntelFolder.classList.add("ready");
    els.btnIntelFolder.title = `Change Intelligence Folder (current: ${label})`;
  } else if (!hasDirectoryPicker()) {
    els.intelFolderStatus.textContent =
      "No folder API — will download .md (use Chrome/Edge)";
    els.intelFolderStatus.className = "intel-folder-status warn";
    els.btnIntelFolder.classList.remove("ready");
    els.btnIntelFolder.title = "File System Access API unavailable";
  } else {
    els.intelFolderStatus.textContent = wasIntelligenceSetupSkipped()
      ? "No vault — click 📁 to set intelligence folder"
      : "Pick a parent folder → creates GRIMOIRE-FocusIntelligence/";
    els.intelFolderStatus.className = "intel-folder-status";
    els.btnIntelFolder.classList.remove("ready");
    els.btnIntelFolder.title = "Set / change Intelligence Folder";
  }
}

async function onChooseIntelFolder() {
  if (!hasDirectoryPicker()) {
    toast("Use Chrome or Edge for on-disk vault writes", "");
    await refreshIntelFolderUi();
    return;
  }
  try {
    const handle = await chooseIntelligenceFolder();
    setVaultFailState(false);
    toast(`Vault ready: ${handle.name}/`, "success");
    activityPing(`✦ Vault linked: ${handle.name}/`);
    await refreshIntelFolderUi();
    for (const c of state.conversations) {
      await writeFocusIntelligence(c, state.spells);
    }
    persist();
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.warn(err);
    setVaultFailState(true);
    toast("Could not open folder", "");
  }
}

/**
 * Self-init: auto-prompt for parent folder, create vault, seed Focus files.
 */
async function bootstrapIntelligenceVault() {
  if (!hasDirectoryPicker()) {
    await refreshIntelFolderUi();
    return;
  }
  try {
    const handle = await ensureIntelligenceFolder({ forcePrompt: false });
    await refreshIntelFolderUi();
    if (handle) {
      for (const c of state.conversations) {
        await writeFocusIntelligence(c, state.spells);
      }
      persist();
      if (!wasIntelligenceSetupSkipped()) {
        toast(`Intelligence vault: ${handle.name}/`, "success");
      }
    } else if (!wasIntelligenceSetupSkipped()) {
      // First run cancelled — status line shows how to set later
    }
  } catch (err) {
    if (err?.name !== "AbortError") console.warn(err);
    await refreshIntelFolderUi();
  }
}


/**
 * INTEL ATLAS — read-only surface of everything Grimoire knows about a Focus.
 * Stars densen numerically; Atlas makes the intelligence legible.
 */
function listSlice(arr, n = 6) {
  return (arr || []).filter(Boolean).slice(0, n);
}

function recentUserIntel(convo, n = 5) {
  return [...(convo?.messages || [])]
    .reverse()
    .filter((m) => m.role === "user" && String(m.text || "").trim())
    .slice(0, n)
    .map((m) => String(m.text).replace(/\s+/g, " ").trim().slice(0, 140));
}

function buildFocusIntelAtlas(convo, spells = state.spells) {
  const snap = deriveFocusSnapshot(convo, spells);
  if (!convo) {
    return {
      empty: true,
      title: "Intel Atlas",
      subtitle: "Select a focus to inspect its intelligence.",
      sections: [],
    };
  }

  if (convo.alignmentNotes && !convo.alignmentProfile) {
    convo.alignmentProfile = parseAlignmentIntelligence(convo.alignmentNotes);
  }
  const p = convo.alignmentProfile || {};
  const focusType = getFocusType(convo);
  const sealed = getSealedChannel(convo);
  const focusSpells = (spells || []).filter(
    (s) => s.conversationId === convo.id && !isReceiptSpell(s)
  );
  const ready = focusSpells.filter((s) => s.status !== "sent");
  const sent = focusSpells.filter((s) => s.status === "sent");
  const stage = universeStage(snap.intelCount, snap.spellsSent, snap.aligned);
  const isAi = isAiNode(convo);
  const isPersonFocus = isPerson(convo) || focusType === "person";
  const purpose =
    p.purpose ||
    (isAi
      ? "Engineer transmissions that extract / progress this node."
      : isPersonFocus
        ? "Remember who they are. Craft messages, reminders, and action-spells (real-world care counts)."
        : "Broadcast / network field craft — spells are signals and actions.");

  const sections = [];
  sections.push({
    title: "Identity",
    kv: [
      ["Focus", convo.name],
      ["Type", focusType],
      ["Channel", sealed],
      ["Stage", stage.name],
      ["Intel bits", String(snap.intelCount)],
      ["Stars (sky)", String(getUniverseHud().starCount || 0)],
      ["Signal", p.signal != null ? `${p.signal}/10` : "—"],
      ["Aligned", snap.aligned ? "YES" : "NO"],
    ],
  });

  // Healer Health Covenant — multi-condition bar, per Focus type
  const health = computeFocusHealth(convo, spells);
  sections.push({
    title: "Healer Health Covenant",
    health,
    lines: [health.healerNote, `Next restore spell: ${healerHealthSpellHint(health)}`],
  });

  sections.push({ title: "Purpose", lines: [purpose] });
  if (listSlice(p.directives).length) {
    sections.push({ title: "Directives (planets)", lines: listSlice(p.directives, 8) });
  }
  if (listSlice(p.capabilities).length) {
    sections.push({ title: "Capabilities", lines: listSlice(p.capabilities, 6) });
  }
  if (listSlice(p.constraints).length) {
    sections.push({ title: "Constraints", lines: listSlice(p.constraints, 6) });
  }
  if (listSlice(p.doctrine).length) {
    sections.push({ title: "Doctrine", lines: listSlice(p.doctrine, 5) });
  }
  if (listSlice(p.frames).length) {
    sections.push({ title: "Frames", tags: listSlice(p.frames, 8) });
  }
  if (listSlice(p.opsFacts).length) {
    sections.push({ title: "Ops facts", lines: listSlice(p.opsFacts, 6) });
  }
  const recent = recentUserIntel(convo, 5);
  if (recent.length) {
    sections.push({ title: "Recent captures", lines: recent });
  }
  sections.push({
    title: "Spell stack",
    kv: [
      ["Ready", String(ready.length)],
      ["Sent", String(sent.length)],
      ["Images", String(snap.imageCount || 0)],
      ["Pulses", String(snap.pulseCount || 0)],
    ],
    lines: ready.slice(0, 4).map((s) => s.purpose || "untitled"),
  });
  if (!snap.aligned && isAi) {
    sections.push({
      title: "Next gate",
      lines: [
        "Cast Spell → Alignment Reveal",
        "Send to node via sealed channel",
        "Paste full reply here to ignite universe + unlock engineered spells",
      ],
    });
  }

  return {
    empty: false,
    title: `${convo.name} · Atlas`,
    subtitle: isAi
      ? "AI node universe — knowledge compound; spells progress the node."
      : isPersonFocus
        ? "Person universe — eternal memory; spells are messages or real-world actions."
        : "Network universe — signals + group actions.",
    sections,
    stage: stage.name,
    stats: {
      intel: snap.intelCount,
      directives: snap.directives,
      ready: ready.length,
      sent: sent.length,
      signal: p.signal,
    },
  };
}

/** Live DOM nodes — never trust boot-time els alone for Atlas. */
function atlasNodes() {
  return {
    root: document.getElementById("universe-legend") || els.universeLegend,
    title: document.getElementById("atlas-title") || els.atlasTitle,
    sub: document.getElementById("atlas-sub") || els.atlasSub,
    body: document.getElementById("atlas-body") || els.atlasBody,
    close: document.getElementById("btn-atlas-close") || els.btnAtlasClose,
  };
}

/** Resolve active Focus even if activeId is briefly stale. */
function resolveAtlasFocus(preferred) {
  if (preferred) return preferred;
  const byId = activeConvo();
  if (byId) return byId;
  const nameEl = document.getElementById("entity-name");
  const shown = (nameEl?.textContent || "").trim();
  if (shown && shown !== "Select a focus") {
    const match = state.conversations.find(
      (c) => String(c.name || "").toLowerCase() === shown.toLowerCase()
    );
    if (match) {
      state.activeId = match.id;
      return match;
    }
  }
  return state.conversations[0] || null;
}

function renderIntelAtlas(convo) {
  const focus = resolveAtlasFocus(convo);
  // Best-effort reinject profile from last rich user paste so Atlas is never shollow void
  if (focus && !focus.alignmentProfile?.directives?.length) {
    const rich = [...(focus.messages || [])]
      .reverse()
      .find(
        (m) =>
          m.role === "user" &&
          /SIGNAL|CAPABILIT|CONSTRAINT|PURPOSE|NEXT THREE|ACTION TAKEN|Pulse:|lane|evidence/i.test(
            m.text || ""
          )
      );
    if (rich?.text && rich.text.length > 40) {
      focus.alignmentProfile = parseAlignmentIntelligence(rich.text);
      if (!focus.alignmentNotes) focus.alignmentNotes = rich.text.slice(0, 8000);
      if (!focus.alignmentRevealed) focus.alignmentRevealed = true;
    }
  }

  const atlas = buildFocusIntelAtlas(focus);
  const n = atlasNodes();
  if (n.title) n.title.textContent = atlas.title;
  if (n.sub) n.sub.textContent = atlas.subtitle;
  if (!n.body) return atlas;

  if (atlas.empty) {
    n.body.innerHTML = `<p class="atlas-empty">${escapeHtml(atlas.subtitle)}</p>`;
    return atlas;
  }

  const html = atlas.sections
    .map((sec) => {
      let body = "";
      if (sec.health) {
        const h = sec.health;
        const bars = (h.conditions || [])
          .map((c) => {
            const w = Math.max(0, Math.min(100, c.score));
            return `<div class="health-row"><span class="health-label">${escapeHtml(
              c.label
            )}</span><div class="health-track"><div class="health-fill band-${escapeHtml(
              h.band
            )}" style="width:${w}%"></div></div><span class="health-score">${w}</span></div>`;
          })
          .join("");
        body += `<div class="health-covenant" data-band="${escapeHtml(h.band)}">
          <div class="health-master">
            <span class="health-hp">HP ${h.hp}</span>
            <span class="health-band">${escapeHtml(h.band.toUpperCase())}</span>
            <span class="health-recipe">${escapeHtml(h.label)}</span>
          </div>
          <div class="health-master-track"><div class="health-master-fill band-${escapeHtml(
            h.band
          )}" style="width:${h.hp}%;background:${escapeHtml(h.color)}"></div></div>
          ${bars}
        </div>`;
      }
      if (sec.kv && sec.kv.length) {
        body += `<dl class="atlas-kv">${sec.kv
          .map(
            ([k, v]) =>
              `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v ?? "—"))}</dd>`
          )
          .join("")}</dl>`;
      }
      if (sec.lines && sec.lines.length) {
        body += `<ul>${sec.lines
          .map((l) => `<li>${escapeHtml(String(l))}</li>`)
          .join("")}</ul>`;
      }
      if (sec.tags && sec.tags.length) {
        body += `<div class="atlas-tagrow">${sec.tags
          .map((t) => `<span class="atlas-tag">${escapeHtml(String(t))}</span>`)
          .join("")}</div>`;
      }
      return `<section class="atlas-section"><h4>${escapeHtml(
        sec.title
      )}</h4>${body}</section>`;
    })
    .join("");
  n.body.innerHTML =
    html ||
    `<p class="atlas-empty">No structured intel yet — speak about this Focus.</p>`;
  return atlas;
}

function setAtlasOpen(open) {
  state.atlasOpen = Boolean(open);
  const at = atlasNodes();
  if (!at || !at.root) return;
  if (open) {
    renderIntelAtlas(at.focus);
    at.root.removeAttribute("hidden");
    at.root.setAttribute("aria-hidden", "false");
  } else {
    at.root.setAttribute("hidden", "");
    at.root.setAttribute("aria-hidden", "true");
  }
}

function toggleAtlas() {
  const leg = atlasNodes().root;
  if (!leg) return;
  const open = !leg.hasAttribute("hidden");
  setAtlasOpen(!open);
}
/**
 * Cast Spell = consolidate Focus intelligence → restructure ready spells.
 * 1) Re-parse latest user intel into alignmentProfile when present
 * 2) Strip receipt/echo cards
 * 3) Forge ONE best next spell against atlas (upgrade REBUILT in place)
 * Spells = messages to AI/people OR action-spells (real-world doings as castable care).
 */
function consolidateAndRestructureSpells(convo) {
  if (!convo) return { spell: null, purged: 0, atlas: null };

  const source =
    convo.alignmentNotes ||
    [...(convo.messages || [])]
      .reverse()
      .find(
        (m) =>
          m.role === "user" &&
          /SIGNAL|CAPABILIT|CONSTRAINT|PURPOSE|ALIGNMENT|NEXT THREE|ACTION TAKEN|Pulse:/i.test(
            m.text || ""
          )
      )?.text ||
    "";
  if (source && source.length > 40) {
    convo.alignmentProfile = parseAlignmentIntelligence(source);
    if (!convo.alignmentNotes) convo.alignmentNotes = source.slice(0, 8000);
  }

  const before = state.spells.length;
  stripReceiptSpells(convo.id);
  state.spells = dedupeSpells(
    (state.spells || []).filter((s) => !isReceiptSpell(s))
  );
  const purged = Math.max(0, before - state.spells.length);

  const atlas = buildFocusIntelAtlas(convo);
  const readyHint = (() => {
    const p = convo.alignmentProfile || {};
    if (isAiNode(convo) && !convoAlignmentUnlocked(convo)) return "ALIGNMENT REVEAL";
    if (p.directives?.length) return `PROGRESS: ${p.directives[0]}`;
    const recent = recentUserIntel(convo, 1)[0];
    if (recent) return recent;
    if (isPerson(convo)) return `Check-in / remembered action for ${convo.name}`;
    return `Next highest-value cast for ${convo.name}`;
  })();

  const spell = generateAndStoreSpell(convo, readyHint, { silentToast: true });
  return { spell, purged, atlas, readyHint };
}

function castSpell() {
  const convo = activeConvo();
  if (!convo) return;

  ensureAlignmentDirective(convo);

  const medium = syncMediumFromControls(convo);

  // Focus-first gate messaging when blocked
  if (
    isAiNode(convo) &&
    convoHasAlignmentSpell(convo) &&
    !convoAlignmentUnlocked(convo)
  ) {
    convo.messages.push({
      id: uid("msg"),
      role: "grimoire",
      text: `**Lock alignment first.** Paste the Alignment Reveal reply for **${convo.name} · ${medium}** to unlock engineered spells.`,
      ts: Date.now(),
    });
    persist();
    renderChat();
    renderIntelAtlas(convo);
    return;
  }

  const { spell, purged, atlas } = consolidateAndRestructureSpells(convo);

  if (!spell || spell.blocked) {
    toast(spell?.reason || "Could not consolidate / forge spell", "");
    renderIntelAtlas(convo);
    renderSpells();
    return;
  }

  const craft = spell.crafted ? ` ${spell.crafted}.` : "";
  const type = getFocusType(convo);
  const personHint =
    type === "person" || type === "network"
      ? " Spells may be messages **or** action-spells (real-world doings cast as care)."
      : "";
  const purgeNote =
    purged > 0
      ? ` Purged **${purged}** receipt/echo card${purged === 1 ? "" : "s"}.`
      : "";
  const dirN =
    atlas?.stats?.directives ||
    convo.alignmentProfile?.directives?.length ||
    0;

  convo.messages.push({
    id: uid("msg"),
    role: "grimoire",
    text: isAlignmentSpell(spell)
      ? `**Intel consolidated.** Alignment Reveal ready for **${convo.name} · ${medium}**. Open Spells → Copy → send via ${medium} → paste full reply here to ignite the universe.${purgeNote}`
      : `**Intel consolidated · spells restructured.** Ready: **${spell.purpose}.**${craft}${dirN ? ` Locked to **${dirN}** directives.` : ""}${personHint}${purgeNote} Open Spells panel. ★ HUD = Intel Atlas.`,
    ts: Date.now(),
  });

  if (!state.spellsOpen) {
    state.spellsOpen = true;
    els.app?.classList.remove("spells-collapsed");
  }

  persist();
  renderChat();
  renderSpells();
  renderIntelAtlas(convo);
  toast(
    isAlignmentSpell(spell)
      ? "Alignment Reveal consolidated"
      : `Ready spell: ${String(spell.purpose || "").slice(0, 48)}`,
    "success"
  );
}

async function copySpell(id) {
  const spell = state.spells.find((s) => s.id === id);
  if (!spell) return;
  const md = formatSpellMarkdown(spell);
  try {
    await navigator.clipboard.writeText(md);
    toast("Spell copied to clipboard", "success");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = md;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("Spell copied to clipboard", "success");
  }
}

function markSent(id) {
  const spell = state.spells.find((s) => s.id === id);
  if (!spell) return;
  spell.status = "sent";

  // If alignment was sent, nudge user to paste the reply
  if (isAlignmentSpell(spell)) {
    const convo = state.conversations.find((c) => c.id === spell.conversationId);
    if (convo) {
      convo.messages.push({
        id: uid("msg"),
        role: "grimoire",
        text: `Alignment Reveal marked **Sent**. When **${spell.target}** replies, paste their reveal here — I'll lock future spells to that frame.`,
        ts: Date.now(),
      });
    }
  }

  persist();
  renderSpells();
  renderConvoList();
  renderChat();

  const focus = state.conversations.find((c) => c.id === spell.conversationId);
  if (focus) {
    // Permanent constellation line lock
    if (state.activeId === focus.id) {
      universeEvent("sent", {
        spellsSent: spellsFor(focus.id).filter((s) => s.status === "sent").length,
      });
      setFocusUniverse(deriveFocusSnapshot(focus, state.spells), { warp: false });
    }
    syncFocusIntelligenceFile(
      focus,
      "SPELL_SENT",
      `${spell.purpose} marked SENT via ${spell.medium}`
    );
  }

  toast("Spell marked as Sent", "success");
}

function createConversation({ name, type, aiSubtype, channel, archetype, medium } = {}) {
  let t = type;
  if (!t) {
    if (archetype === "person") t = "person";
    else if (archetype === "network") t = "network";
    else if (archetype) t = "ai";
    else t = "person";
  }

  const sealed =
    t === "ai"
      ? aiSubtype || medium || "Hermes"
      : channel || medium || (t === "network" ? "LinkedIn" : "Discord");

  // One Focus = one name + one sealed channel
  if (focusExists(state.conversations, name.trim(), sealed)) {
    toast(`Focus already sealed: ${name.trim()} · ${sealed}`);
    const existing = state.conversations.find(
      (c) =>
        focusIdentityKey(c.name, getSealedChannel(c)) ===
        focusIdentityKey(name.trim(), sealed)
    );
    if (existing) {
      state.activeId = existing.id;
      persist();
      renderAll();
    }
    return;
  }

  let id = makeFocusId(name.trim(), sealed);
  if (state.conversations.some((c) => c.id === id)) {
    id = `${id}-${Date.now().toString(36).slice(-4)}`;
  }

  const messages = [];
  if (t === "ai") {
    messages.push({
      id: uid("msg"),
      role: "grimoire",
      text: `Sealed channel: **${name.trim()} · ${sealed}**. Hit **Cast Spell** for Alignment Reveal on this backend only.`,
      ts: Date.now(),
      kind: "alignment-directive",
    });
  } else {
    messages.push({
      id: uid("msg"),
      role: "grimoire",
      text: `Sealed channel: **${name.trim()} · ${sealed}**. Speak about them — spells stay on this channel only.`,
      ts: Date.now(),
    });
  }

  const convo = {
    id,
    name: name.trim(),
    archetype: archetype || "person",
    medium: sealed,
    backend: sealed,
    type: t,
    star: randomStarPosition(state.conversations),
    messages,
  };

  applyFocusClassification(convo, {
    type: t,
    aiSubtype: t === "ai" ? sealed : undefined,
    channel: t !== "ai" ? sealed : undefined,
    backend: sealed,
  });

  // Strip any legacy auto-discovery suggestion messages from all focuses
  for (const f of state.conversations) {
    f.messages = (f.messages || []).filter((m) => m.kind !== "focus-suggestion");
  }

  state.conversations.push(convo);
  state.activeId = convo.id;
  persist();
  renderAll();
  // Auto-create Focus .md in GRIMOIRE-FocusIntelligence/
  syncFocusIntelligenceFile(
    convo,
    "FOCUS_CREATED",
    `Sealed channel: ${convo.name} · ${sealed}`
  );
  toast(`Focus sealed: ${convo.name} · ${sealed}`);
}

// ─── Events ───

// Delegated copy for chat message bubbles
els.chatMessages.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-copy-msg, .copy-btn");
  if (!btn) return;
  const msgId = btn.getAttribute("data-msg-id");
  if (!msgId) return;
  const convo = activeConvo();
  const msg = convo?.messages?.find((m) => m.id === msgId);
  const text = msg?.text;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied", "success");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("Copied", "success");
  }
});

els.chatForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!activeConvo()) return;
  const text = (els.chatInput?.value || "").trim();
  const convo = activeConvo();
  const hasImages = !!(convo?.pendingImages && convo.pendingImages.length);
  if (!text && !hasImages) return;
  els.chatInput.value = "";
  autoResizeTextarea();
  sendMessage(text);
});

els.chatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.chatForm?.requestSubmit();
  }
});

els.chatInput?.addEventListener("paste", (e) => {
  const convo = activeConvo();
  if (!convo) return;
  const items = Array.from(e.clipboardData?.items || []);
  const files = items
    .filter((it) => it.type.startsWith("image/"))
    .map((it) => it.getAsFile())
    .filter(Boolean);
  if (files.length) {
    e.preventDefault();
    queuePastedImages(files);
  }
});

els.chatInput?.addEventListener("input", autoResizeTextarea);

els.btnCast?.addEventListener("click", castSpell);

els.btnAttach?.addEventListener("click", () => {
  const convo = activeConvo();
  if (!convo || !convo.pendingImages || !convo.pendingImages.length) {
    toast("Paste an image into the input first", "");
    return;
  }
  clearPendingImages();
  toast("Pending images cleared", "success");
});

els.newType?.addEventListener("change", () => {
  syncNewFocusModalFields();
});

function toggleSpells() {
  state.spellsOpen = !state.spellsOpen;
  persist();
  const appEl = els.app || document.querySelector(".app");
  if (appEl) {
    // Collapses only .spells-panel via CSS; chat stays intact
    appEl.classList.toggle("spells-collapsed", !state.spellsOpen);
  }
}

els.btnToggleSpells?.addEventListener("click", toggleSpells);
els.btnCloseSpells?.addEventListener("click", () => {
  if (state.spellsOpen) toggleSpells();
});

// "+ New Focus" — must always bind (never behind a throwing listener)
els.btnNew?.addEventListener("click", () => {
  showNewFocusModal({ name: "", type: "person", channel: "Discord" });
});

els.btnClearAll?.addEventListener("click", () => {
  requestClearAllSpells();
});

els.btnCancelNew?.addEventListener("click", () => {
  els.dialog?.close();
});

els.btnIntelFolder?.addEventListener("click", () => {
  onChooseIntelFolder();
});

els.btnSidebarToggle?.addEventListener("click", () => {
  toggleSidebar();
});

function resetApp() {
  if (!confirm("Reset Grimoire? This clears all focuses, spells, and saved state.")) return;
  try {
    localStorage.removeItem("grimoire-state-v1");
    localStorage.removeItem("grimoire-sidebar-collapsed-v1");
  } catch {}
  state.conversations = [];
  state.spells = [];
  state.activeId = null;
  state.spellsOpen = true;
  els.app?.classList.remove("spells-collapsed");
  persist();
  renderAll();
  toast("App reset — fresh start", "success");
}

els.btnResetApp?.addEventListener("click", resetApp);

els.newForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = (els.newName?.value || "").trim();
  if (!name) return;
  const type = els.newType?.value || "person";
  const sealed =
    type === "ai"
      ? els.newAiSubtype?.value || "Hermes"
      : els.newChannel?.value || (type === "network" ? "LinkedIn" : "Discord");
  createConversation({
    name,
    type,
    aiSubtype: type === "ai" ? sealed : undefined,
    channel: type !== "ai" ? sealed : undefined,
    medium: sealed,
  });
  els.dialog?.close();
});

// ─── Utils ───

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMessageHtml(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function escapeAttr(str) {
  return escapeHtml(String(str)).replace(/'/g, "&#39;");
}

// ─── Boot ───

// Purge legacy auto-discovery suggestion messages (sealed channel purity)
state.conversations.forEach((c) => {
  c.messages = (c.messages || []).filter((m) => m.kind !== "focus-suggestion");
  ensureAlignmentDirective(c);
});
persist();

// Universe Engine — canvas cosmos behind HUD
if (els.universeCanvas) {
  initUniverse(els.universeCanvas, {
    onHud: (info) => {
      if (els.universeHudCount) els.universeHudCount.textContent = String(info.starCount || 0);
      if (els.universeHudStage) els.universeHudStage.textContent = info.stageName || "VOID";
    },
  });
}

els.universeHud?.addEventListener("click", () => {
  toggleAtlas();
});
els.btnAtlasClose?.addEventListener("click", () => setAtlasOpen(false));

if (!state.spellsOpen) els.app.classList.add("spells-collapsed");
applySidebarCollapsed(loadSidebarCollapsed());
// Silent merge of kind+purpose duplicates on load
state.spells = dedupeSpells(
  (state.spells || []).filter((s) => !isReceiptSpell(s))
);
renderAll();
// Initial universe for active focus (no warp on first paint)
{
  const snap = deriveFocusSnapshot(activeConvo(), state.spells);
  setFocusUniverse(snap, { warp: false });
  updateUniverseHudChrome(snap);
}

// Self-init intelligence vault (creates GRIMOIRE-FocusIntelligence/)
bootstrapIntelligenceVault().finally(() => {
  if (activeConvo()) els.chatInput?.focus();
});
