/**
 * Grimoire MVP — core loop (GBG: Grimoire Builds Grimoire)
 *
 * AI nodes: alignment-first → then auto-spell on intent
 * Person/network: conversational + auto-propose spells when intent is clear
 * Cast Spell still works; Grimoire also initiates without waiting.
 */

import {
  ARCHETYPES,
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
  spellsAreSameKindPurpose,
  normalizePurposeKey,
  classifySpellDisplay,
  spellPasteHint,
  isSelfCastSpell,
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
const UNIVERSE_VIEW_KEY = "grimoire-universe-view-v1";

// ─── State ───

const state = loadState();
// Hide-chat / pure universe view (not part of vault state — UI chrome only)
state.universeView = (() => {
  try {
    return localStorage.getItem(UNIVERSE_VIEW_KEY) === "1";
  } catch {
    return false;
  }
})();

// Runtime purge for stale removed focuses that may still exist in saved state.
(function purgeRemovedFocuses() {
  const removedIds = new Set(["misty-discord"]);
  const before = state.conversations.length;
  state.conversations = state.conversations.filter((c) => !removedIds.has(c.id));
  const removed = before - state.conversations.length;
  if (removed > 0) {
    state.spells = (state.spells || []).filter((s) => !removedIds.has(s.conversationId));
    if (state.activeId && state.conversations.find((c) => c.id === state.activeId)) {
      // keep active if still valid
    } else if (state.conversations.length) {
      state.activeId = state.conversations[0].id;
    } else {
      state.activeId = null;
    }
    persist();
  }
})();

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
  btnUniverseView: $("#btn-universe-view"),
  btnUniverseViewExit: $("#btn-universe-view-exit"),
  universeViewChrome: $("#universe-view-chrome"),
  universeViewFocusIcon: $("#universe-view-focus-icon"),
  universeViewFocusName: $("#universe-view-focus-name"),
  universeViewFocusMeta: $("#universe-view-focus-meta"),
  universeViewSystemLabels: $("#universe-view-system-labels"),
  btnCloseSpells: $("#btn-close-spells"),
  btnIntelFolder: $("#btn-intel-folder"),
  btnResetApp: $("#btn-reset-app"),
  vaultFailDot: $("#vault-fail-dot"),
  intelFolderStatus: $("#intel-folder-status"),
  btnClearAll: $("#btn-clear-all"),
  spellCount: $("#spell-count") || document.getElementById("spell-count"),
  spellsList: $("#spells-list"),
  spellsHint: $("#spells-hint"),
  tabSpellsActive: $("#tab-spells-active"),
  tabSpellsHistory: $("#tab-spells-history"),
  littleChat: $("#little-chat"),
  littleChatBody: $("#little-chat-body"),
  littleChatMessages: $("#little-chat-messages"),
  littleChatForm: $("#little-chat-form"),
  littleChatInput: $("#little-chat-input"),
  btnLittleChatSend: $("#btn-little-chat-send"),
  btnLittleChatToggle: $("#btn-little-chat-toggle"),
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
  newModelLabel: $("#new-model-label"),
  newModel: $("#new-entity-model"),
  newFocusHint: $("#new-focus-hint"),
  btnCancelNew: $("#btn-cancel-new"),
  appSettingsPanel: $("#app-settings-panel"),
  btnAppSettings: $("#btn-app-settings"),
  btnAppSettingsClose: $("#btn-app-settings-close"),
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

/** Active queue only — never cast / history entries. */
function activeSpellsFor(convoId) {
  return spellsFor(convoId)
    .filter((s) => s.status !== "sent")
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Cast History — sealed casts, newest answer first. */
function historySpellsFor(convoId) {
  return spellsFor(convoId)
    .filter((s) => s.status === "sent")
    .sort((a, b) => (b.sentAt || b.createdAt || 0) - (a.sentAt || a.createdAt || 0));
}

function pendingCount(convoId) {
  return activeSpellsFor(convoId).length;
}

/** Short human time for spell lifecycle chips. */
function formatSpellTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function setSpellView(view) {
  state.spellView = view === "history" ? "history" : "active";
  persist();
  renderSpells();
}

function ensureSpellView() {
  if (state.spellView !== "history") state.spellView = "active";
  return state.spellView;
}

/**
 * When the Operator pastes a real reply / densen block, stamp the most recent
 * unanswered CAST spell with answeredAt. Time becomes truth for Cast History.
 */
function stampSpellAnsweredFromIngest(convo, userText) {
  if (!convo || !userText) return;
  const t = String(userText).trim();
  if (t.length < 40 && t !== ".") return;
  // Avoid stamping pure outbound intents as answers
  const outboundish =
    /^(do|please|ask|tell|send|open|cast|implement|build|run|make|draft)\b/i.test(t) &&
    t.length < 160 &&
    !/\bACTION TAKEN\b|\bEVIDENCE\b|\bNEXT THREE\b|\bSignal:\s*\d/i.test(t);
  if (outboundish) return;

  const newest = historySpellsFor(convo.id).find((s) => !s.answeredAt);
  if (!newest) return;
  newest.answeredAt = Date.now();
  newest.answerExcerpt = t.replace(/\s+/g, " ").trim().slice(0, 280);
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

  // Purge Focus references from saved browser state
  purgeFocusFromStorage(focusId, focus);

  persist();
  renderAll();
  toast(`Focus purged: ${label}`, "success");
}

/** Remove all cached traces of a Focus from localStorage/vault state. */
function purgeFocusFromStorage(focusId, focus) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return;

    const id = String(focusId || "").trim();
    if (!id) return;

    let changed = false;
    if (Array.isArray(data.conversations)) {
      const before = data.conversations.length;
      data.conversations = data.conversations.filter((c) => String(c?.id || "").trim() !== id);
      changed = changed || data.conversations.length !== before;
    }
    if (Array.isArray(data.spells)) {
      const before = data.spells.length;
      data.spells = data.spells.filter((s) => String(s?.conversationId || "").trim() !== id);
      changed = changed || data.spells.length !== before;
    }
    if (data.activeId === focusId) {
      data.activeId = (data.conversations && data.conversations[0]?.id) || null;
      changed = true;
    }
    if (changed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch {
    // ignore quota/parse errors
  }

  // Vault file cleanup is already attempted above; keep silent on missing files.
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

  const arch = ARCHETYPES[convo.archetype] || ARCHETYPES.wizard || { icon: "✧" };
  els.entityIcon.textContent = arch.icon || "✧";
  els.entityName.textContent = convo.name;
  els.entityType.textContent = typeof typeLabel === "function" ? typeLabel(convo) : (convo.type || "—");
  if (els.sealedChannelValue) {
    els.sealedChannelValue.textContent = getSealedChannel(convo);
  }
  if (els.universeStage) {
    const snap = deriveFocusSnapshot(convo, state.spells);
    els.universeStage.textContent = `${getSealedChannel(convo)} · ${snap?.stageName || "VOID"}`;
  }
  setChatControlsEnabled(true);
  if (isAiNode(convo) && !convoAlignmentUnlocked(convo)) {
    els.chatInput.placeholder = `Speak about ${convo.name} — or Cast Spell for Alignment Reveal…`;
  } else if (isAiNode(convo)) {
    els.chatInput.placeholder = `Speak about ${convo.name} — densen intel or Cast Spell…`;
  } else {
    els.chatInput.placeholder = `Speak to Grimoire about ${convo.name}…`;
  }

  if (!convo.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <div class="empty-glyph">${arch.icon || "✧"}</div>
      <p>Focus on <strong>${escapeHtml(convo.name)}</strong> is open.</p>
      <p class="empty-hint">${
        isAiNode(convo)
          ? "AI nodes start with Alignment Reveal. Speak about the node → stars densen → Cast Spell consolidates atlas + ready stack. Spells panel only."
          : "Talk about them — Grimoire remembers eternally. Cast Spell consolidates intel into messages <em>or</em> action-spells."
      }</p>
    `;
    els.chatMessages.appendChild(empty);
    return;
  }

  // System labels (frame held / receipt densen) only in universe view — never in AI chat
  convo.messages.forEach((m) => {
    if (m.kind === "focus-suggestion") return;
    if (m.role === "spell") return;

    // Inbound receipts → system labels (universe view chrome only)
    if (m.kind === "inbound-intel") return;

    // Explicit system-role messages stay out of chat UI
    if (m.role === "system" || m.role === "System") return;

    els.chatMessages.appendChild(renderMessage(m));
  });

  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  // Universe view chrome carries system labels when chat is hidden
  updateUniverseSystemLabels(convo);
}

function renderMessage(m) {
  const div = document.createElement("div");
  if (m.role === "user") {
    div.className = "message user";
  } else if (m.role === "grimoire") {
    div.className = "message grimoire";
  } else {
    // System messages are not shown in AI chat (universe view only)
    div.className = "message system system-chat-hidden";
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

/** Map inbound / system messages → short system labels for universe view only. */
function systemLabelFromMessage(m) {
  if (!m) return null;
  if (m.kind === "inbound-intel") {
    if (isHoldOrLoopReply(m.text)) return "System frame held — not recast";
    if (isInboundNodeIntel(m.text)) return "Node receipt densened — no new spell forged";
    return "Inbound intel densened";
  }
  if (m.role === "system" || m.role === "System") {
    const t = String(m.text || "").replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 120) : "System";
  }
  return null;
}

/** Latest system labels for the active Focus (deduped, newest last). */
function collectSystemLabels(convo, limit = 4) {
  if (!convo) return [];
  const out = [];
  let lastInbound = null;
  for (const m of convo.messages || []) {
    if (m.kind === "inbound-intel") {
      const label = systemLabelFromMessage(m);
      if (label && label !== lastInbound) {
        out.push(label);
        lastInbound = label;
      }
      continue;
    }
    lastInbound = null;
    const label = systemLabelFromMessage(m);
    if (label) out.push(label);
  }
  return out.slice(-limit);
}

/**
 * System labels live only in universe view (chat hidden).
 * Never shown as chat bubbles while AI chat is visible.
 */
function updateUniverseSystemLabels(convo) {
  const host = els.universeViewSystemLabels || document.getElementById("universe-view-system-labels");
  if (!host) return;
  if (!state.universeView) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  const labels = collectSystemLabels(convo || activeConvo());
  if (!labels.length) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.innerHTML = labels
    .map(
      (label) =>
        `<span class="universe-system-label" title="${escapeAttr(label)}">${escapeHtml(label)}</span>`
    )
    .join("");
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

  const view = ensureSpellView();
  const readyList = convo ? activeSpellsFor(convo.id) : [];
  const histList = convo ? historySpellsFor(convo.id) : [];
  const list = view === "history" ? histList : readyList;
  const pending = readyList.length;
  const total = convo ? spellsFor(convo.id).length : 0;

  // Sidebar / header spell count for active Focus (active only)
  const countEl = els.spellCount || document.getElementById("spell-count");
  if (countEl) {
    const n = pending > 0 ? pending : 0;
    countEl.textContent = n > 0 ? String(n) : "";
    countEl.dataset.count = String(n);
  }

  // Tabs
  els.tabSpellsActive?.classList.toggle("active", view === "active");
  els.tabSpellsHistory?.classList.toggle("active", view === "history");
  if (els.tabSpellsActive) {
    els.tabSpellsActive.setAttribute("aria-selected", view === "active" ? "true" : "false");
  }
  if (els.tabSpellsHistory) {
    els.tabSpellsHistory.setAttribute("aria-selected", view === "history" ? "true" : "false");
    els.tabSpellsHistory.textContent = histList.length
      ? `Cast History (${histList.length})`
      : "Cast History";
  }
  if (els.spellsHint) {
    els.spellsHint.textContent =
      view === "history"
        ? "Cast History is sealed truth — forged, cast, and answered times. Double-tap ✕ only to prune sludge."
        : "Copy seals the cast (sent + timestamp). Paste the reply into chat to densen, then Cast Spell for the next true priority.";
  }

  if (els.btnClearAll) {
    els.btnClearAll.disabled = !convo || view === "history" || readyList.length === 0;
    els.btnClearAll.textContent = view === "history" ? "—" : "Clear Active";
    els.btnClearAll.title =
      view === "history"
        ? "History is sealed — clear only per-card with ✕"
        : "Clear all active spells for this focus (history kept)";
  }

  // Reset clear-all confirm UI on re-render
  if (typeof resetClearAllButton === "function") resetClearAllButton();

  if (!convo) {
    els.spellsList.innerHTML = `<div class="spells-empty">Select a focus to see its spells.</div>`;
    return;
  }

  if (!list.length) {
    els.spellsList.innerHTML = `<div class="spells-empty">${
      view === "history"
        ? "No cast history yet.<br/>Copy a READY spell — it drops here with timestamps."
        : isAiNode(convo) && !convoAlignmentUnlocked(convo)
          ? "Cast Spell for <strong>Alignment Reveal</strong>, or state intent in chat."
          : isAiNode(convo)
            ? "State intent in chat or hit <strong>Cast Spell</strong> to forge a directive."
            : "Talk to Grimoire — clear intent auto-casts a spell."
    }</div>`;
    return;
  }

  els.spellsList.innerHTML = "";
  if (view === "history") {
    list.forEach((spell) => {
      const item = document.createElement("article");
      const showSelf = shouldShowSelfCastButton(spell, convo);
      // Only stamp true self-cast protocol cards (never curiosity / blanket Focus)
      if (showSelf && spell.kind !== "self-cast" && !isAlignmentSpell(spell) && !isCuriositySpell(spell)) {
        spell.kind = "self-cast";
      }
      item.className = "spell-item spell-history" + (showSelf ? " spell-self-castable" : "");
      item.dataset.spellId = spell.id;
      if (showSelf) item.dataset.selfCast = "1";
      const md = formatSpellMarkdown(spell);
      const badgeText = spell.rebuilt ? "REFILLED" : escapeHtml(spell.status || "sent");
      const timeLine = [
        spell.createdAt ? `forged ${formatSpellTime(spell.createdAt)}` : "",
        spell.copiedAt ? `copied ${formatSpellTime(spell.copiedAt)}` : "",
        spell.sentAt ? `cast ${formatSpellTime(spell.sentAt)}` : "",
        spell.answeredAt ? `answered ${formatSpellTime(spell.answeredAt)}` : "",
      ]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" · ");
      item.innerHTML = `
        <button type="button" class="delete-btn" data-action="delete" title="Prune from history (two-tap)">✕</button>
        ${spellCardTopHtml(spell, convo, { badgeClass: "status-badge sent", badgeText })}
        <p class="spell-essence">${escapeHtml(spell.essence)}</p>
        ${timeLine ? `<div class="spell-timestamps">${timeLine}</div>` : ""}
        ${spellActionsHtml(spell, convo, { isSent: true })}
        <pre class="spell-full">${escapeHtml(md)}</pre>
      `;
      wireSpellCardActions(item, spell, { sealOnCopy: false });
      els.spellsList.appendChild(item);
    });
    return;
  }

  // Active view = priority ladder
  const primary = readyList[0];
  const rest = readyList.slice(1);
  els.spellsList.innerHTML = "";

  function appendSpellCard(spell, mode) {
    const item = document.createElement("article");
    const isSent = spell.status === "sent";
    const showSelf = shouldShowSelfCastButton(spell, convo);
    if (showSelf && spell.kind !== "self-cast" && !isAlignmentSpell(spell) && !isCuriositySpell(spell)) {
      spell.kind = "self-cast";
    }
    item.className =
      "spell-item" +
      (isSent ? " spell-history" : "") +
      (mode === "primary" ? " spell-primary" : " spell-hold") +
      (showSelf ? " spell-self-castable" : "");
    item.dataset.spellId = spell.id;
    if (showSelf) item.dataset.selfCast = "1";
    const md = formatSpellMarkdown(spell);
    const badgeClass = isSent
      ? "status-badge sent"
      : spell.rebuilt
        ? "status-badge rebuilt"
        : `status-badge ${spell.status || "ready"}`;
    const badgeText = isSent
      ? "CAST"
      : spell.rebuilt
        ? "REFILLED"
        : mode === "primary"
          ? "CAST THIS"
          : escapeHtml(spell.status || "ready");
    const timeBits = [];
    if (spell.createdAt) timeBits.push(`forged ${formatSpellTime(spell.createdAt)}`);
    if (spell.rebuiltAt && !isSent) timeBits.push(`refilled ${formatSpellTime(spell.rebuiltAt)}`);
    if (spell.copiedAt) timeBits.push(`copied ${formatSpellTime(spell.copiedAt)}`);
    if (spell.sentAt) timeBits.push(`cast ${formatSpellTime(spell.sentAt)}`);
    if (spell.answeredAt) timeBits.push(`answered ${formatSpellTime(spell.answeredAt)}`);
    const timeLine = timeBits.length
      ? `<div class="spell-timestamps">${escapeHtml(timeBits.join(" · "))}</div>`
      : "";
    item.innerHTML = `
      <button type="button" class="delete-btn" data-action="delete" title="${isSent ? "Prune from history (two-tap)" : "Delete spell"}">✕</button>
      ${spellCardTopHtml(spell, convo, { badgeClass, badgeText })}
      <p class="spell-essence">${escapeHtml(spell.essence)}</p>
      ${timeLine}
      ${spellActionsHtml(spell, convo, { isSent })}
      <pre class="spell-full">${escapeHtml(md)}</pre>
    `;
    wireSpellCardActions(item, spell, { sealOnCopy: !isSent });
    els.spellsList.appendChild(item);
  }

  if (primary) {
    appendSpellCard(primary, "primary");
  }
  rest.forEach((spell) => appendSpellCard(spell, "hold"));
}

/** Brand-new forge: ready, never refilled, never copied/cast. */
function spellIsBrandNew(spell) {
  if (!spell) return false;
  if (spell.rebuilt || spell.rebuiltAt) return false;
  if (spell.status === "sent" || spell.sentAt || spell.copiedAt) return false;
  return true;
}

/**
 * AI-node bridge: curiosity ecosystem cards or spells that map linked nodes
 * back to this Focus as nucleus.
 */
function spellIsNodeBridge(spell) {
  if (!spell) return false;
  if (isCuriositySpell(spell)) return true;
  if (spell.autoGenerated && (spell.curiosityMode === "self" || spell.curiosityMode === "user")) {
    return true;
  }
  const body = [spell.purpose, spell.essence, spell.crafted, spell.message]
    .filter(Boolean)
    .join("\n");
  if (/CURIOSITY\s*[·.]/i.test(String(spell.purpose || ""))) return true;
  if (
    /LINKED NODE|NUCLEUS FOCUS|ecosystem links|ecosystem probe|ecosystem brief/i.test(body) &&
    /tie-?back|orbit|nucleus|linked/i.test(body)
  ) {
    return true;
  }
  return false;
}

/**
 * Status column: optional NEW + BRIDGE indicators + primary status (REFILLED/CAST/…).
 * Kept flex-shrink:0 so long titles cannot push badges off-panel.
 */
function spellIndicatorsHtml(spell, { badgeClass, badgeText }) {
  const chips = [];
  if (spellIsBrandNew(spell)) {
    chips.push(
      `<span class="status-badge status-new" title="Brand-new spell — not yet copied or cast">NEW</span>`
    );
  }
  if (spellIsNodeBridge(spell)) {
    chips.push(
      `<span class="status-badge status-bridge" title="AI node bridge — linked intelligence ties back to this Focus as nucleus">⟷ BRIDGE</span>`
    );
  }
  chips.push(`<span class="${escapeHtml(badgeClass)}">${badgeText}</span>`);
  return `<div class="spell-item-badges">${chips.join("")}</div>`;
}

/**
 * Card header: title truncates; badges stay visible (fixes REFILLED overflow).
 */
function spellCardTopHtml(spell, convo, { badgeClass, badgeText }) {
  const title = String(spell.purpose || "untitled");
  return `
    <div class="spell-item-top">
      <div class="spell-item-head">
        <div class="spell-item-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        ${spellKindMetaHtml(spell, convo)}
      </div>
      ${spellIndicatorsHtml(spell, { badgeClass, badgeText })}
    </div>`;
}

/**
 * Color-coded spell kind label — never "Local · directive · aligned · sealed".
 * SELF-CAST is green; button injects into Focus chat (no copy/paste).
 */
function spellKindMetaHtml(spell, convo) {
  const kind = classifySpellDisplay(spell, convo);
  const hover = kind.key === "self-cast"
    ? kind.hover
    : spellPasteHint(spell, convo) || kind.hover;
  return `<div class="spell-item-meta"><span class="spell-kind ${escapeHtml(kind.css)}" title="${escapeHtml(hover)}">${escapeHtml(kind.label)}</span></div>`;
}

/** Resolve the Focus that owns this spell (never rely on active alone). */
function resolveSpellFocus(spell, fallback) {
  if (spell?.conversationId) {
    const hit = state.conversations.find((c) => c.id === spell.conversationId);
    if (hit) return hit;
  }
  return fallback || activeConvo();
}

/**
 * Show SELF-CAST only for self-recursive spells.
 * Uses Focus identity + kind + Local·GRIMOIRE_ protocol so the button appears
 * even when older localStorage cards still say kind: "directive".
 */
function shouldShowSelfCastButton(spell, convo) {
  if (!spell || isCuriositySpell(spell) || isAlignmentSpell(spell)) return false;
  const focus = resolveSpellFocus(spell, convo);
  if (isSelfCastSpell(spell, focus)) return true;
  try {
    if (classifySpellDisplay(spell, focus)?.key === "self-cast") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Action row — SELF-CAST immediately before Copy (self-recursive only).
 */
function spellActionsHtml(spell, convo, { isSent }) {
  const self = shouldShowSelfCastButton(spell, convo);
  // Fixed order: SELF-CAST (optional) → Copy → View
  const selfBtn = self
    ? `<button type="button" class="btn-spell self-cast" data-action="self-cast" title="Enter this spell into the current Focus chat automatically — no copy/paste" aria-label="SELF-CAST into Focus chat">SELF-CAST</button>`
    : "";
  return `<div class="spell-actions${self ? " has-self-cast" : ""}">${selfBtn}<button type="button" class="btn-spell copy" data-action="copy">${isSent ? "Copy again" : "Copy"}</button><button type="button" class="btn-spell expand" data-action="expand">View</button></div>`;
}

function wireSpellCardActions(item, spell, { sealOnCopy }) {
  const selfBtn = item.querySelector('[data-action="self-cast"]');
  if (selfBtn) {
    selfBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selfCastSpell(spell.id);
    });
  }
  item.querySelector('[data-action="copy"]')?.addEventListener("click", () =>
    copySpell(spell.id, { seal: sealOnCopy })
  );
  item.querySelector('[data-action="expand"]')?.addEventListener("click", () => {
    item.classList.toggle("expanded");
    const btn = item.querySelector('[data-action="expand"]');
    if (btn) btn.textContent = item.classList.contains("expanded") ? "Hide" : "View";
  });
  item.querySelector('[data-action="delete"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    requestDeleteSpell(spell.id, e.currentTarget);
  });
}

/** True while SELF-CAST is injecting into chat — skip auto-forge echo. */
let selfCastInFlight = false;

/**
 * SELF-CAST — inject spell into the current Focus AI chat (no copy/paste).
 * Seals to Cast History and runs the normal chat densen loop.
 */
function selfCastSpell(id) {
  const spell = state.spells.find((s) => s.id === id);
  if (!spell) return;

  const focus = resolveSpellFocus(spell, activeConvo());
  if (!focus) {
    toast("Select a Focus first", "");
    return;
  }

  if (!shouldShowSelfCastButton(spell, focus)) {
    toast("SELF-CAST is only for self-recursive spells", "");
    return;
  }

  // Normalize kind so re-renders always show the button after seal
  if (spell.kind !== "self-cast") spell.kind = "self-cast";

  // Land in the spell's Focus chat (nucleus for this cast)
  if (state.activeId !== focus.id) {
    state.activeId = focus.id;
    persist();
    renderAll();
  }

  const body = String(spell.message || formatSpellMarkdown(spell) || "").trim();
  if (!body) {
    toast("Spell has no body to cast", "");
    return;
  }

  // Seal first so the card moves to history as the cast lands
  if (spell.status !== "sent") {
    markSent(id, { fromSelfCast: true, silent: true });
  } else {
    spell.copiedAt = Date.now();
    persist();
  }

  selfCastInFlight = true;
  try {
    sendMessage(body);
  } finally {
    selfCastInFlight = false;
  }

  toast("SELF-CAST — spell entered into Focus chat (no copy/paste)", "success");
  els.chatInput?.focus();
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
  if (ensureSpellView() === "history") {
    toast("History is sealed — use Active tab + Clear Active", "");
    return;
  }
  const list = activeSpellsFor(convo.id);
  if (!list.length) {
    toast("No active spells to clear", "");
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
    btn.textContent = "CONFIRM CLEAR ACTIVE?";
    btn.title = "Tap again to wipe active spells (history kept)";
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
    els.btnClearAll.textContent =
      ensureSpellView() === "history" ? "—" : "Clear Active";
    els.btnClearAll.title =
      ensureSpellView() === "history"
        ? "History is sealed — clear only per-card with ✕"
        : "Clear all active spells for this focus (history kept)";
  }
}

function clearAllSpellsForFocus(focusId) {
  // Only active — never wipe Cast History
  const removeIds = new Set(
    state.spells
      .filter((s) => s.conversationId === focusId && s.status !== "sent")
      .map((s) => s.id)
  );
  state.spells = state.spells.filter((s) => !removeIds.has(s.id));

  const focus = state.conversations.find((c) => c.id === focusId);
  if (focus) {
    focus.messages = (focus.messages || []).filter(
      (m) => !(m.role === "spell" && removeIds.has(m.spellId))
    );
  }

  persist();
  renderAll();
  notifyConstellation(focusId, "standard");
  if (focus) syncFocusIntelligenceFile(focus);

  toast("Active spells cleared — history kept", "success");
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
  const densen =
    hud.densenProgress != null
      ? hud.densenProgress
      : snap?.densenProgress != null
        ? snap.densenProgress
        : 0;
  const densenPct = Math.round(Math.max(0, Math.min(1, densen)) * 100);
  const ageLabel = hud.ageLabel || "";
  const convo = activeConvo();
  const health = convo ? computeFocusHealth(convo, state.spells) : null;
  if (els.universeHudCount) els.universeHudCount.textContent = String(starCount);
  if (els.universeHudStage) {
    const densenBit = densenPct > 0 ? ` · densen ${densenPct}%` : "";
    const ageBit = ageLabel ? ` · age ${ageLabel}` : "";
    const hpBit = health ? ` · ${healthHudChip(health)}` : "";
    els.universeHudStage.textContent = `${stageName}${densenBit}${ageBit}${hpBit}`;
  }
  if (els.universeHud) {
    const temporal = `Stars fill as vault densens · densen ${densenPct}%${ageLabel ? ` · Focus age ${ageLabel}` : ""}`;
    els.universeHud.title = health
      ? `${health.summary} — ${temporal}`
      : `Intel Atlas — ${temporal}`;
  }
  if (els.universeStage) {
    els.universeStage.textContent = snap?.focusId
      ? `${stageName}${densenPct ? ` · ${densenPct}%` : ""}${health ? ` · HP ${health.hp}` : ""}`
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
  applyUniverseViewMode();
  renderConvoList();
  renderChat();
  renderSpells();
  renderLittleChat();
  renderStars();
  updateAttachButtonState();
  renderPendingImages();
  if (els.universeLegend && !els.universeLegend.hasAttribute("hidden")) {
    renderIntelAtlas(activeConvo());
  }
}

// ─── Complex spell little chat (quantum leap plans) ───

const LITTLE_CHAT_COLLAPSE_KEY = "grimoire-little-chat-collapsed-v1";

function ensureLittleChat(convo) {
  if (!convo) return null;
  if (!convo.littleChat || typeof convo.littleChat !== "object") {
    convo.littleChat = { messages: [], leaps: [] };
  }
  if (!Array.isArray(convo.littleChat.messages)) convo.littleChat.messages = [];
  if (!Array.isArray(convo.littleChat.leaps)) convo.littleChat.leaps = [];
  return convo.littleChat;
}

function loadLittleChatCollapsed() {
  try {
    return localStorage.getItem(LITTLE_CHAT_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function setLittleChatCollapsed(collapsed) {
  try {
    localStorage.setItem(LITTLE_CHAT_COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
  els.littleChat?.classList.toggle("collapsed", Boolean(collapsed));
  if (els.btnLittleChatToggle) {
    els.btnLittleChatToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
}

function renderLittleChat() {
  const convo = activeConvo();
  const box = els.littleChatMessages;
  const input = els.littleChatInput;
  const send = els.btnLittleChatSend;
  if (!box) return;

  const enabled = Boolean(convo);
  if (input) {
    input.disabled = !enabled;
    input.placeholder = enabled
      ? `Direct plan for ${convo.name} — quantum leaps that unlock more…`
      : "Select a Focus for complex spell plans…";
  }
  if (send) send.disabled = !enabled;

  box.innerHTML = "";
  if (!convo) {
    box.innerHTML = `<div class="little-chat-empty">Select a Focus — little chat densens complex / quantum-leap plans for that nucleus only.</div>`;
    return;
  }

  const lc = ensureLittleChat(convo);
  if (!lc.messages.length) {
    box.innerHTML = `<div class="little-chat-empty">Speak a <strong>quantum leap plan</strong> here — separate from the main chat. Unlocks denser spells for <strong>${escapeHtml(convo.name)}</strong>.</div>`;
    return;
  }

  for (const m of lc.messages) {
    const row = document.createElement("div");
    row.className = `little-chat-msg ${m.role === "user" ? "user" : "grimoire"}`;
    const who = m.role === "user" ? "You" : "Grimoire";
    row.innerHTML = `<span class="little-chat-who">${who}</span><div class="little-chat-text">${formatMessageHtml(m.text || "")}</div>`;
    box.appendChild(row);
  }
  box.scrollTop = box.scrollHeight;
}

/**
 * Local reply for complex-spell little chat — quantum leap plans that unlock Focus densen.
 * Never writes into the main Focus chat stream.
 */
function littleChatReply(convo, userText) {
  const name = convo.name || "Focus";
  const ch = getSealedChannel(convo);
  const t = String(userText || "").trim();
  const lower = t.toLowerCase();
  const lc = ensureLittleChat(convo);

  // Extract leap seeds (short clauses)
  const leapBits = t
    .split(/[.\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 140)
    .slice(0, 3);

  let unlocked = false;
  for (const bit of leapBits) {
    const key = bit.toLowerCase();
    if (!lc.leaps.some((l) => String(l).toLowerCase() === key)) {
      lc.leaps.push(bit.slice(0, 120));
      unlocked = true;
    }
  }
  // Cap leap memory
  if (lc.leaps.length > 12) lc.leaps = lc.leaps.slice(-12);

  const isLeap =
    unlocked ||
    /\b(quantum|leap|unlock|complex|plan|phase|breakthrough|threshold|densify|next level|open the)\b/i.test(
      lower
    ) ||
    t.length >= 40;

  if (isLeap) {
    densenConstellationFromIntel(convo, unlocked ? 2 : 1);
    universeEvent("intel", { count: unlocked ? 2 : 1 });
    syncFocusIntelligenceFile(
      convo,
      "QUANTUM_LEAP_PLAN",
      t.slice(0, 1200)
    );
  }

  const leapList =
    lc.leaps.length > 0
      ? lc.leaps
          .slice(-4)
          .map((l, i) => `${i + 1}. ${l}`)
          .join("\n")
      : "— none locked yet —";

  if (/\b(hello|hi|hey)\b/i.test(lower) && t.length < 24) {
    return `Little chat for **${name}** (${ch}). State a **quantum leap plan** — direct, complex, what unlocks next for this nucleus. Main chat stays clean.`;
  }

  if (unlocked || isLeap) {
    return [
      `**Leap densened** for **${name}** (nucleus).`,
      unlocked
        ? `Locked ${leapBits.length || 1} plan thread(s) into Focus intelligence.`
        : `Plan held — keep sharpening the leap until it unlocks a concrete spell path.`,
      ``,
      `**Quantum leap threads on file:**`,
      leapList,
      ``,
      `Next: refine the plan here, or **Cast Spell** in the main rail to forge the complex transmission against this densen.`,
    ].join("\n");
  }

  return `Heard on **${name}**. Little chat is for **quantum leap / complex spell plans** that unlock more for this Focus. Name the leap (what becomes true, what unlocks, one next move).`;
}

function sendLittleChatMessage(text) {
  const convo = activeConvo();
  if (!convo) return;
  const userText = String(text || "").trim();
  if (!userText) return;

  const lc = ensureLittleChat(convo);
  lc.messages.push({
    id: uid("lcm"),
    role: "user",
    text: userText,
    ts: Date.now(),
  });

  const reply = littleChatReply(convo, userText);
  lc.messages.push({
    id: uid("lcm"),
    role: "grimoire",
    text: reply,
    ts: Date.now(),
  });

  // Keep little chat lean
  if (lc.messages.length > 40) {
    lc.messages = lc.messages.slice(-40);
  }

  persist();
  renderLittleChat();
  // Refresh sky densen + spells panel (leaps may unlock craft)
  const snap = deriveFocusSnapshot(convo, state.spells);
  setFocusUniverse(snap, { warp: false });
  updateUniverseHudChrome(snap);
  renderSpells();
  toast("Little chat densened · Focus leap", "success");
}

/** Persist + apply hide-chat / universe-only mode. */
function setUniverseView(on, { silent = false } = {}) {
  state.universeView = Boolean(on);
  try {
    localStorage.setItem(UNIVERSE_VIEW_KEY, state.universeView ? "1" : "0");
  } catch {
    /* ignore */
  }
  applyUniverseViewMode();
  // Keep sky live for the active Focus nucleus
  const snap = deriveFocusSnapshot(activeConvo(), state.spells);
  setFocusUniverse(snap, { warp: false });
  updateUniverseHudChrome(snap);
  if (!silent) {
    toast(
      state.universeView
        ? "Universe view — chat hidden · Focus is nucleus"
        : "Chat restored",
      "success"
    );
  }
}

function applyUniverseViewMode() {
  const on = Boolean(state.universeView);
  els.app?.classList.toggle("universe-view", on);
  document.body.classList.toggle("universe-view-active", on);
  if (els.btnUniverseView) {
    els.btnUniverseView.setAttribute("aria-pressed", on ? "true" : "false");
    els.btnUniverseView.title = on
      ? "Show chat"
      : "Hide chat — view universe only (stars · lines · Focus nucleus)";
  }
  if (els.universeViewChrome) {
    if (on) els.universeViewChrome.removeAttribute("hidden");
    else els.universeViewChrome.setAttribute("hidden", "");
  }
  // Focus nucleus label on chrome
  const convo = activeConvo();
  if (els.universeViewFocusName) {
    els.universeViewFocusName.textContent = convo?.name || "No Focus";
  }
  if (els.universeViewFocusMeta) {
    const ch = convo ? getSealedChannel(convo) : "—";
    els.universeViewFocusMeta.textContent = convo ? `${ch} · nucleus` : "select a Focus";
  }
  if (els.universeViewFocusIcon && convo) {
    const arch = ARCHETYPES[convo.archetype];
    els.universeViewFocusIcon.textContent = arch?.icon || "☉";
  }
  // System labels (frame held, receipt densen) only when chat is hidden
  updateUniverseSystemLabels(convo);
}

function toggleUniverseView() {
  setUniverseView(!state.universeView);
}

// ─── Actions ───

function selectConvo(id) {
  if (state.activeId === id) {
    // Force re-render of this Focus sky even on re-tap
    const snap = deriveFocusSnapshot(activeConvo(), state.spells);
    setFocusUniverse(snap, { warp: false });
    updateUniverseHudChrome(snap);
    return;
  }
  state.activeId = id;
  const convo = activeConvo();
  if (convo) ensureAlignmentDirective(convo);
  persist();
  // Warp to this Focus's universe — always paint starfield for this Focus
  const snap = deriveFocusSnapshot(convo, state.spells);
  setFocusUniverse(snap, { warp: true });
  // Auto-generate self/user curiosity spells about linked ecosystem nodes
  if (convo) autoGenerateCuriositySpells(convo, { silentToast: true });
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
  const inboundReceipt = isInboundNodeIntel(userText) || isHoldOrLoopReply(userText);

  if (inboundReceipt) {
    // Densens + stamp answers, but don't pollute chat with fake-user bubbles.
    // Still persists to vault via ingestIntelligence / stampSpellAnsweredFromIngest.
    convo.messages.push({
      id: uid("msg"),
      role: "user",
      text: userText,
      images: sentImages,
      ts: Date.now(),
      kind: "inbound-intel",
    });

    ensureAlignmentDirective(convo);
    const medium = syncMediumFromControls(convo);
    const ingested = ingestIntelligence(convo, userText);
    stampSpellAnsweredFromIngest(convo, userText);

    persist();
    renderChat();
    renderConvoList();
    renderSpells();
    renderIntelAtlas(convo);

    // System frame / receipt labels: universe view only (never pollute AI chat)
    if (state.universeView) {
      const receipt =
        ingested?.alignmentJustLocked
          ? "Alignment reply received — spellcraft unlocked."
          : isHoldOrLoopReply(userText)
            ? "System frame held — not recast"
            : "Node receipt densened — no new spell forged";
      toast(receipt, "");
      updateUniverseSystemLabels(convo);
    }
    return;
  }

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

  // Chrono-Ring lite: if this looks like a node/entity reply, stamp CAST cards answered
  stampSpellAnsweredFromIngest(convo, userText);

  // Auto-generate self-curious + user-curious ecosystem spells (Focus = nucleus)
  autoGenerateCuriositySpells(convo, { silentToast: true });

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
    /\b(advance to|execute move|designate|order|dispatch|disperse|run the|forge me|give me a spell|craft a|send this|next shift is|new constrained ask|change the spell)\b/i.test(
      t
    )
  ) {
    return false;
  }
  // Classic node reply shapes + hold / loop / no-duplicate formation
  if (
    /^(SPELL RECEIVED|FRAME HOLDING|SPELL DUPLICATE DETECTED|CONSTELLATION READ|TRANSPARENCY|ACTION TAKEN|CONFIRMED\.|MOVE \d|NEXT THREE MOVES|CURRENT STATE|OVERALL:|SIGNAL:|LOOP RECEIVED|LOOP DETECTED)/im.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(Pulse:\s*\.|Signal:\s*\d+\/10|EVIDENCE:|NEXT THREE MOVES|ACTION TAKEN|FRAME HOLDING|ALREADY FORGED|NO CHANGE SINCE LAST ACK|LOOP RECEIVED|LOOP DETECTED|NO DUPLICATE CAST|NO DUPLICATE ARROWS|HOLDING FORMATION|FRAME ALREADY MAINTAINED|NO DRIFT TO CORRECT|FRAME MAINTAINED|FRAME LOCKED)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // Markdown status tables from nodes
  if (/^\|.+\|[\s\S]*\|----/m.test(t) && /(LOCK|ACTIVE|PENDING|EXECUTED|MOVE)/i.test(t)) {
    return true;
  }
  return false;
}

/** WK / node is holding formation — densen only, do not mint maintain-loop spells. */
function isHoldOrLoopReply(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return (
    /\b(loop received|loop detected|no duplicate cast|no duplicate arrows|holding formation|frame already maintained|no drift to correct|no additional action required this pulse|same spell, same payload|stop casting|won't re-cast|will not re-cast|no new ask)\b/i.test(
      t
    ) ||
    (/\bACTION TAKEN\b/i.test(t) &&
      /\b(frame already maint|already cast|no additional action|maintain)/i.test(t))
  );
}

/** Extract open move lines from latest densen / WK map on this focus. */
function extractNextMovesFromConvo(convo) {
  const blobs = [];
  if (convo?.alignmentNotes) blobs.push(convo.alignmentNotes);
  for (const m of [...(convo?.messages || [])].reverse().slice(0, 12)) {
    if (m.role === "user" && m.text) blobs.push(m.text);
  }
  const moves = [];
  for (const blob of blobs) {
    const t = String(blob || "");
    // Numbered under NEXT THREE MOVES or free numbered priorities
    const section = t.match(
      /NEXT THREE MOVES[\s\S]{0,40}([\s\S]{0,900}?)(?:##\s*SIGNAL|##\s*SIGNAL\/PULSE|SIGNAL\/PULSE|Signal:|Pulse:|---|Filed:|$)/i
    );
    const body = section ? section[1] : t;
    const re = /(?:^|\n)\s*(?:[-*]|\d+[.)])\s+\*?\*?(.+?)(?:\*\*)?(?=\n|$)/g;
    let m;
    while ((m = re.exec(body)) && moves.length < 8) {
      const line = m[1].replace(/\s+/g, " ").trim();
      if (line.length < 12 || line.length > 160) continue;
      if (/^silence vs|^one-line map|^signal/i.test(line)) continue;
      if (!moves.some((x) => normalizePurposeKey(x) === normalizePurposeKey(line))) {
        moves.push(line);
      }
    }
    if (moves.length) break;
  }
  return moves;
}

function purposeLooksLikeHoldLoop(purpose) {
  const p = normalizePurposeKey(purpose);
  return (
    /loop received|no duplicate|frame maintained|maintain frame|holding formation|response locked|no additional action|already cast into/.test(
      p
    )
  );
}

/** Prefer first open move not already sealed in recent Cast History. */
function nextTruePriorityHint(convo) {
  const hist = historySpellsFor(convo.id).slice(0, 8);
  const active = activeSpellsFor(convo.id);
  const taken = new Set(
    [...hist, ...active]
      .map((s) => normalizePurposeKey(s.purpose))
      .filter(Boolean)
  );
  const moves = extractNextMovesFromConvo(convo);
  for (const move of moves) {
    const key = normalizePurposeKey(move);
    // soft match against taken
    let covered = false;
    for (const t of taken) {
      if (t === key || (t.length >= 10 && (t.includes(key.slice(0, 24)) || key.includes(t.slice(0, 24))))) {
        covered = true;
        break;
      }
      const tokens = (s) => new Set(s.split(" ").filter((w) => w.length > 3));
      const ta = tokens(t);
      const tb = tokens(key);
      let hit = 0;
      for (const w of tb) if (ta.has(w)) hit++;
      if (hit >= 2 && hit / Math.max(ta.size, tb.size) >= 0.5) {
        covered = true;
        break;
      }
    }
    if (!covered && !purposeLooksLikeHoldLoop(move)) {
      return move.length > 72 ? move.slice(0, 69) + "…" : move;
    }
  }
  // Directive list fallback — skip hold-ish first directives
  const dirs = convo.alignmentProfile?.directives || [];
  for (const d of dirs) {
    if (!purposeLooksLikeHoldLoop(d) && !taken.has(normalizePurposeKey(d))) {
      return `PROGRESS: ${d}`.slice(0, 80);
    }
  }
  return null;
}

function forgeAfterUserTurn(convo, userText, turnReply) {
  if (!convo) return null;
  // SELF-CAST already sealed the spell — do not mint an echo
  if (selfCastInFlight) return null;
  const text = String(userText || "").trim();
  const medium = syncMediumFromControls(convo);
  const alignmentUnlocked = convoAlignmentUnlocked(convo);
  const hasAlignmentSpell = convoHasAlignmentSpell(convo);

  // INTEL INGEST ≠ SPELL FORGE. Vault + constellation still densen outside this gate.
  // Inbound node ACKs/status only auto-forge pre-alignment (capture the reveal itself).
  if (alignmentUnlocked && (isInboundNodeIntel(text) || isHoldOrLoopReply(text))) {
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
    // Soft false positives: "no duplicate cast", "stop casting" contain "cast" as hold language
    if (isHoldOrLoopReply(text)) return null;

    if (convo.alignmentNotes && !convo.alignmentProfile) {
      convo.alignmentProfile = parseAlignmentIntelligence(convo.alignmentNotes);
    }
    const forgeHint = nextTruePriorityHint(convo) || text;
    const spell = generateSpell(convo, medium, forgeHint, {
      allSpells: state.spells,
    });
    // Safety: never commit a reveal after lock
    if (isAlignmentSpell(spell)) return null;
    // Never store pure receipt titles
    if (isReceiptSpell(spell) || purposeLooksLikeHoldLoop(spell.purpose)) return null;
    // Don't re-queue a purpose already CAST in recent history without new ask
    const recentCast = historySpellsFor(convo.id)
      .slice(0, 5)
      .some((s) => spellsAreSameKindPurpose(s, spell));
    if (recentCast && isHoldOrLoopReply(text)) return null;
    commitSpell(convo, spell, { silentToast: true });
    return spell;
  }

  if (isPerson(convo) || isNetwork(convo)) {
    if (isInboundNodeIntel(text) || isHoldOrLoopReply(text)) return null;
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
    if (isReceiptSpell(spell) || purposeLooksLikeHoldLoop(spell.purpose)) return null;
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
function openNewFocusModal({ name, archetype, type, model } = {}) {
  if (!els.dialog || !els.newName) {
    console.warn("New Focus dialog missing from DOM");
    return;
  }

  els.newName.value = name || "";

  let t = type;
  if (!t) {
    if (archetype === "person") t = "person";
    else if (archetype && ["wizard", "sage", "knight", "healer"].includes(archetype)) t = "ai";
    else t = "person";
  }
  // Create UI is person | ai only
  if (t !== "ai") t = "person";

  if (els.newType) els.newType.value = t;
  if (els.newModel) {
    const m = model && model !== "Open" ? model : "none";
    els.newModel.value = m;
  }
  syncNewFocusFormChrome();

  try {
    els.dialog.showModal();
  } catch (err) {
    if (typeof els.dialog.show === "function") els.dialog.show();
    else els.dialog.setAttribute("open", "");
  }
  els.newName.focus();
  els.newName.select();
}

/** Show optional Model only for AI; person medium stays open by design. */
function syncNewFocusFormChrome() {
  const t = els.newType?.value || "person";
  const isAi = t === "ai";
  if (els.newModelLabel) els.newModelLabel.hidden = !isAi;
  if (els.newFocusHint) {
    els.newFocusHint.textContent = isAi
      ? "AI: densen this node and craft curated words-as-magic. Model is optional — Hermes, Grok, Claude, Custom, or open. Medium of delivery is whatever surface you choose."
      : "Person: densen who they are and craft message-spells for real life. Medium is open — Discord, text, in-person, anything.";
  }
}

/** @deprecated — ingestIntelligence is the single path */
function maybeCaptureAlignmentNotes(convo, userText) {
  const r = ingestIntelligence(convo, userText);
  return Boolean(r?.alignmentJustLocked || convo?.alignmentReceived);
}

/**
 * Steering — Focus is always the sun/nucleus.
 * Spells may radiate to any pertinent AI node in user reality; things adapt,
 * reality is explained, and all intelligence densens back to this Focus.
 * Focus is *curious* about linked intelligence on other AI nodes and ties it home.
 * Only a hard "switch Focus" request is guided (never auto-create / never abandon nucleus).
 */
function detectHardFocusSwitch(convo, userText) {
  const text = (userText || "").trim();
  if (!text || !convo) return null;

  // Multi-node spell routes are allowed. Only catch explicit switch/open intents.
  const switchRe =
    /\b(?:switch(?:\s+to)?|open\s+focus|go\s+to\s+focus|change\s+focus\s+to|leave\s+this\s+focus)\b/i;
  if (!switchRe.test(text)) return null;

  for (const f of state.conversations) {
    if (f.id === convo.id) continue;
    const n = (f.name || "").trim();
    if (n.length < 3) continue;
    if (new RegExp(`\\b${escapeRegExp(n)}\\b`, "i").test(text)) {
      return `${n} · ${getSealedChannel(f)}`;
    }
  }
  return null;
}

/** Other Focus names mentioned for multi-node steering notes (not blocks). */
function detectPertinentNodes(convo, userText) {
  const text = (userText || "").trim();
  if (!text || !convo) return [];
  const hits = [];
  for (const f of state.conversations) {
    if (f.id === convo.id) continue;
    const n = (f.name || "").trim();
    if (n.length < 3) continue;
    if (new RegExp(`\\b${escapeRegExp(n)}\\b`, "i").test(text)) {
      hits.push(`${n} · ${getSealedChannel(f)}`);
    }
  }
  return hits;
}

/**
 * Linked intelligence on other ecosystem nodes (AI / person / network).
 * Fuel for curiosity notes + auto-generated curiosity spells.
 * Each entry explains how the node relates to this Focus as nucleus.
 */
function gatherLinkedNodeIntel(convo) {
  if (!convo) return [];
  const scored = [];
  for (const f of state.conversations || []) {
    if (!f || f.id === convo.id) continue;
    const type = getFocusType(f);
    const ch = getSealedChannel(f);
    const p = f.alignmentProfile || {};
    const bits = [];
    let score = 0;

    if (f.alignmentRevealed || f.alignmentReceived || f.alignmentNotes) {
      bits.push("aligned");
      score += 3;
    }
    if (p.signal != null) {
      bits.push(`signal ${p.signal}/10`);
      score += Number(p.signal) || 0;
    }
    if (p.directives?.length) {
      bits.push(`${p.directives.length} dirs`);
      score += p.directives.length;
    }
    if (p.purpose) {
      bits.push(String(p.purpose).slice(0, 48));
      score += 1;
    }
    const spells = (state.spells || []).filter((s) => s.conversationId === f.id);
    const ready = spells.filter((s) => s.status !== "sent").length;
    const sent = spells.filter((s) => s.status === "sent").length;
    if (ready) {
      bits.push(`${ready} ready`);
      score += ready;
    }
    if (sent) {
      bits.push(`${sent} cast`);
      score += sent;
    }
    const userMsgs = (f.messages || []).filter((m) => m.role === "user" && String(m.text || "").trim());
    if (userMsgs.length) score += Math.min(userMsgs.length, 5);
    const lastUser = [...userMsgs].reverse().find((m) => String(m.text || "").trim().length > 20);
    if (lastUser) {
      bits.push(`last: ${String(lastUser.text).replace(/\s+/g, " ").trim().slice(0, 42)}`);
      score += 2;
    }
    // Always include sibling Focuses as ecosystem nodes (even thin intel)
    if (!bits.length) bits.push(type || "node");
    score += type === "ai" ? 2 : type === "network" ? 1 : 0;

    const why =
      type === "ai"
        ? `AI node — densen capabilities/constraints that serve **${convo.name}**; discard theater`
        : type === "network"
          ? `Network surface — public-safe signals that advance **${convo.name}** without leaking doctrine`
          : `Person — relationship / message / real-world care that supports **${convo.name}**'s purpose`;

    scored.push({
      focusId: f.id,
      name: f.name,
      channel: ch,
      type,
      summary: bits.slice(0, 4).join(" · "),
      why,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 6);
}

/** Curiosity appendix — ecosystem intel tied back to this Focus as sun. */
function linkedCuriosityNote(convo, userText) {
  const linked = gatherLinkedNodeIntel(convo);
  const mentioned = detectPertinentNodes(convo, userText);
  if (!linked.length && !mentioned.length) return "";

  const parts = [];
  if (linked.length) {
    parts.push(
      linked
        .slice(0, 3)
        .map((l) => `**${l.name} · ${l.channel}** (${l.summary})`)
        .join("; ")
    );
  }
  if (mentioned.length) {
    parts.push(`named: **${mentioned.slice(0, 3).join(", ")}**`);
  }
  return ` **Curiosity (linked nodes):** ${parts.join(" · ")} — **${convo.name}** is the sun/nucleus; what from those worlds densens *this* Focus and why it is important here.`;
}

const CURIOSITY_SELF_PURPOSE = "CURIOSITY · Self — ecosystem links";
const CURIOSITY_USER_PURPOSE = "CURIOSITY · User — ecosystem links";
/** Hard cap: only Self + User curiosity ready per Focus */
const MAX_CURIOSITY_READY = 2;
/** Hard cap: ready self-cast inject cards (not curiosity) per Focus */
const MAX_READY_SELF_CAST = 2;
/** Linked-intel signature cache — skip rebuild when ecosystem map unchanged */
const curiositySigByFocus = new Map();

function isCuriositySpell(spell) {
  if (!spell) return false;
  if (spell.autoGenerated && spell.curiosityMode) return true;
  const p = String(spell.purpose || "");
  return /^CURIOSITY\s*[·.]\s*(Self|User)\b/i.test(p);
}

function curiosityModeOf(spell) {
  if (!spell) return null;
  if (spell.curiosityMode === "self" || spell.curiosityMode === "user") return spell.curiosityMode;
  const p = String(spell.purpose || "");
  if (/CURIOSITY\s*[·.]\s*Self\b/i.test(p)) return "self";
  if (/CURIOSITY\s*[·.]\s*User\b/i.test(p)) return "user";
  return null;
}

/** Ready curiosity spells for a Focus, keyed by mode (at most one each after prune). */
function readyCuriosityByMode(convoId) {
  const ready = (state.spells || []).filter(
    (s) => s.conversationId === convoId && s.status !== "sent" && isCuriositySpell(s)
  );
  const by = { self: null, user: null };
  for (const s of ready) {
    const mode = curiosityModeOf(s);
    if (mode !== "self" && mode !== "user") continue;
    // Keep newest per mode
    if (!by[mode] || (s.createdAt || 0) >= (by[mode].createdAt || 0)) {
      by[mode] = s;
    }
  }
  return by;
}

/**
 * Enforce max 2 ready curiosity spells per Focus (Self + User only).
 * Drops stray / duplicate curiosity cards.
 */
function enforceCuriosityCap(convo) {
  if (!convo) return 0;
  const by = readyCuriosityByMode(convo.id);
  const keepIds = new Set([by.self?.id, by.user?.id].filter(Boolean));
  let removed = 0;
  state.spells = (state.spells || []).filter((s) => {
    if (s.conversationId !== convo.id || s.status === "sent" || !isCuriositySpell(s)) {
      return true;
    }
    if (keepIds.has(s.id)) return true;
    removed += 1;
    return false;
  });
  return removed;
}

function linkedIntelSignature(convo) {
  return gatherLinkedNodeIntel(convo)
    .map((n) => `${n.focusId}:${n.summary}`)
    .join("|");
}

function readySelfCastCount(convo) {
  if (!convo) return 0;
  return (state.spells || []).filter(
    (s) =>
      s.conversationId === convo.id &&
      s.status !== "sent" &&
      !isCuriositySpell(s) &&
      !isAlignmentSpell(s) &&
      isSelfCastSpell(s, convo)
  ).length;
}

/**
 * Build one auto-generated curiosity spell.
 * mode "self" | "user" — only these two exist per Focus.
 * Body always names Focus as NUCLEUS and how each link ties back.
 */
function buildCuriositySpell(convo, mode, medium) {
  if (!convo) return null;
  const nodes = gatherLinkedNodeIntel(convo);
  if (!nodes.length) return null;

  const isSelf = mode === "self";
  const purpose = isSelf ? CURIOSITY_SELF_PURPOSE : CURIOSITY_USER_PURPOSE;
  const focusCh = getSealedChannel(convo);
  const med = medium || focusCh || "Open";
  const nucleus = `${convo.name} · ${focusCh}`;

  const mapLines = nodes.map((n, i) => {
    return [
      `${i + 1}. LINKED NODE: ${n.name} · ${n.channel} (${n.type})`,
      `   Intel: ${n.summary}`,
      `   Orbit of nucleus **${convo.name}**: ${n.why}`,
      `   TIE-BACK TO NUCLEUS: what from ${n.name} densens **${convo.name}**, and why it is important *here* (not there).`,
    ].join("\n");
  });

  const body = isSelf
    ? [
        `${convo.name} —`,
        "",
        "TRANSMISSION TYPE: SELF-CURIOUS ECOSYSTEM PROBE",
        "AUTHORITY: Operator · Focus-as-nucleus",
        `NUCLEUS FOCUS (sun): ${nucleus}`,
        `MEDIUM: ${med}`,
        "LAW: This Focus is the sun/nucleus. All linked intelligence orbits it. Do not abandon this channel.",
        "",
        `HOW **${convo.name}** INTERACTS WITH LINKED NODES:`,
        ...mapLines,
        "",
        "OPERATIONAL ASK (self-curious · nucleus-first):",
        `From inside **${convo.name}** as sun/nucleus, examine the linked nodes above.`,
        "Return:",
        `1. Interaction pattern — how each node currently relates to **${convo.name}**`,
        `2. Useful densen — what signal to absorb into **${convo.name}** and why it strengthens the nucleus`,
        "3. Boundary — what stays on the other node (no wander, no channel abandon)",
        `4. One next move that serves **${convo.name} only** while using linked intel`,
        "",
        "Every answer ties back to the nucleus. Keep sovereign, precise.",
        "",
        "— Operator",
      ].join("\n")
    : [
        `${convo.name} —`,
        "",
        "TRANSMISSION TYPE: USER-CURIOUS ECOSYSTEM BRIEF",
        "AUTHORITY: Operator · Focus-as-nucleus",
        `NUCLEUS FOCUS (sun): ${nucleus}`,
        `MEDIUM: ${med}`,
        "LAW: Operator map — every link is explained only by how it serves this Focus.",
        "",
        `ECOSYSTEM ORBITING **${convo.name}** (nucleus):`,
        ...mapLines,
        "",
        "OPERATIONAL ASK (user-curious · nucleus-first):",
        `Help the operator see the ecosystem *through* **${convo.name}** as sun/nucleus.`,
        "Return:",
        `1. Rank linked nodes by value to **${convo.name}** right now`,
        "2. How the operator should route attention (cast / densen / wait) for the nucleus",
        `3. One user action that compounds **${convo.name}** using another node's intel`,
        `4. One risk if **${convo.name}** is forgotten (channel purity / nucleus drift)`,
        "",
        "Every recommendation ties back to the nucleus. Reality-fit over frame-fit.",
        "",
        "— Operator",
      ].join("\n");

  const nodeNames = nodes
    .slice(0, 3)
    .map((n) => n.name)
    .join(", ");

  // Stable ids so Self/User always upgrade in place (hard max 2)
  const stableId = `${convo.id}-curio-${mode}`;

  return {
    id: stableId,
    conversationId: convo.id,
    target: convo.name,
    purpose,
    medium: med,
    from: "Operator",
    essence: isSelf
      ? `Nucleus **${convo.name}** · self-curious about ${nodes.length} linked node(s): ${nodeNames}`
      : `Nucleus **${convo.name}** · user-curious ecosystem map via ${nodeNames}`,
    crafted: `Auto-generated · max 2 curiosity/Focus · **${convo.name}** is sun/nucleus`,
    message: body,
    status: "ready",
    createdAt: Date.now(),
    kind: isSelf ? "self-check" : "propagate",
    autoGenerated: true,
    curiosityMode: isSelf ? "self" : "user",
    engineeredFromAlignment: false,
  };
}

/**
 * Auto-generate at most 2 curiosity spells per Focus: Self + User.
 * Rebuild only when linked-intel signature changes. Enforces hard cap.
 */
function autoGenerateCuriositySpells(convo, { silentToast = true } = {}) {
  if (!convo || selfCastInFlight) return [];
  if (isAiNode(convo) && !convoAlignmentUnlocked(convo)) {
    enforceCuriosityCap(convo);
    return [];
  }

  const nodes = gatherLinkedNodeIntel(convo);
  if (!nodes.length) {
    enforceCuriosityCap(convo);
    return [];
  }

  const sig = linkedIntelSignature(convo);
  const prev = curiositySigByFocus.get(convo.id);
  const by = readyCuriosityByMode(convo.id);
  // Both slots filled and ecosystem unchanged → no forge
  if (by.self && by.user && prev === sig) {
    enforceCuriosityCap(convo);
    return [];
  }

  const medium = syncMediumFromControls(convo);
  const forged = [];

  for (const mode of ["self", "user"]) {
    const spell = buildCuriositySpell(convo, mode, medium);
    if (!spell) continue;
    const existing = by[mode];
    const sameBody =
      existing &&
      String(existing.message || "") === String(spell.message || "") &&
      String(existing.essence || "") === String(spell.essence || "");
    if (sameBody) continue;

    // Reuse existing slot id so we never mint a 3rd curiosity card
    if (existing?.id) spell.id = existing.id;
    commitSpell(convo, spell, { silentToast: true });
    forged.push(spell);
  }

  enforceCuriosityCap(convo);
  curiositySigByFocus.set(convo.id, sig);

  if (forged.length && !silentToast) {
    toast(
      `Curiosity densened (max 2): Self + User · nucleus **${convo.name}**`,
      "success"
    );
  }
  return forged;
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

  // Hard switch only — multi-node spells radiate from this Focus (sun/nucleus)
  const hardSwitch = detectHardFocusSwitch(convo, userText);
  if (hardSwitch) {
    return {
      reply: `**${convo.name}** remains the sun/nucleus. To densen **${hardSwitch}** as its own world, select that Focus in the sidebar — I will not abandon this channel. You can still cast spells *from here* that target any pertinent AI node; intelligence ties back to **${convo.name}**.${linkedCuriosityNote(convo, userText)}`,
    };
  }

  // SELF-CAST body lands here: respond as nucleus, densen, no re-forge
  if (selfCastInFlight) {
    const linked = linkedCuriosityNote(convo, userText);
    return {
      reply: `**SELF-CAST received** on **${convo.name} · ${medium}**. Spell is in this Focus chat — densening against the nucleus (no copy/paste).${linked} State outcomes or paste external node returns to compound.`,
    };
  }

  const result = isAiNode(convo)
    ? grimoireReplyAiNode(convo, userText, medium)
    : grimoireReplyPersonOrNetwork(convo, userText, medium);

  // Steering: curiosity about linked AI intelligence, always tie back to Focus as sun
  if (result?.reply && !result.reply.includes("Curiosity (linked")) {
    const note = linkedCuriosityNote(convo, userText);
    if (note) result.reply += note;
    else if (!result.reply.includes("sun/nucleus")) {
      const nodes = detectPertinentNodes(convo, userText);
      if (nodes.length) {
        result.reply += ` **Steering:** this Focus is the sun — spells may reach **${nodes.slice(0, 3).join(", ")}**; all returns densen here and explain why they matter to **${convo.name}**.`;
      }
    }
  }
  return result;
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
  // SELF-CAST injects an existing spell — do not mint an echo card
  if (selfCastInFlight) return null;
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
    const paste = spellPasteHint(spell, convo);
    const kind = classifySpellDisplay(spell, convo);
    const selfHint =
      kind.key === "self-cast"
        ? " Hit **SELF-CAST** to enter it into this Focus chat (no copy/paste)."
        : ` **Open Spells panel to copy** — ${paste}.`;
    return {
      reply: `**Spell forged: ${spell.purpose}.**${craft}${n ? ` Locked to **${n}** alignment directives.` : ""} Kind: **${kind.label}**.${selfHint} **${convo.name}** is the sun/nucleus.`,
      spell,
    };
  }

  if (/\b(hello|hi|hey)\b/i.test(userText)) {
    return {
      reply: `Aligned on **${seal}**. **${convo.name}** is the sun/nucleus — curious about linked intelligence on your other AI nodes; returns densen here. Self-recursive spells: hit **SELF-CAST** (no copy/paste). State a directive or ask for a spell.`,
    };
  }

  const n = convo.alignmentProfile?.directives?.length || 0;
  return {
    reply: `Holding **${seal}** with alignment on file${n ? ` (${n} directives)` : ""}. Ask for a spell when you want an engineered cast. Focus stays the sun — multi-node routes + linked-intel curiosity allowed.`,
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

  // Curiosity: never more than Self + User ready; force stable kind/mode
  if (isCuriositySpell(spell)) {
    const mode = curiosityModeOf(spell) || (spell.curiosityMode === "user" ? "user" : "self");
    spell.curiosityMode = mode;
    spell.autoGenerated = true;
    spell.kind = mode === "user" ? "propagate" : "self-check";
    spell.purpose = mode === "user" ? CURIOSITY_USER_PURPOSE : CURIOSITY_SELF_PURPOSE;
    const stableId = `${convo.id}-curio-${mode}`;
    spell.id = stableId;
    // Free stable id from sealed history cards so ready slot can reuse it
    for (const s of state.spells || []) {
      if (s.id === stableId && s.status === "sent") {
        s.id = `${stableId}-hist-${s.sentAt || s.createdAt || Date.now()}`;
      }
    }
    // If both slots full and this is neither existing slot, refuse
    const by = readyCuriosityByMode(convo.id);
    const slot = by[mode];
    const otherCount = (by.self ? 1 : 0) + (by.user ? 1 : 0);
    if (!slot && otherCount >= MAX_CURIOSITY_READY) {
      return;
    }
  }

  // Self-cast over-generation gate: max ready self-cast cards (upgrades still allowed)
  const isSelfCastCard =
    !isCuriositySpell(spell) &&
    !isAlignmentSpell(spell) &&
    (spell.kind === "self-cast" || isSelfCastSpell(spell, convo));
  if (isSelfCastCard) {
    spell.kind = "self-cast";
    const existingSelf = state.spells.find(
      (s) =>
        s.conversationId === convo.id &&
        s.status !== "sent" &&
        (s.id === spell.id || spellsAreSameKindPurpose(s, spell))
    );
    if (!existingSelf && readySelfCastCount(convo) >= MAX_READY_SELF_CAST) {
      // Prefer upgrade of oldest ready self-cast instead of minting a third
      const oldest = (state.spells || [])
        .filter(
          (s) =>
            s.conversationId === convo.id &&
            s.status !== "sent" &&
            !isCuriositySpell(s) &&
            isSelfCastSpell(s, convo)
        )
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
      if (oldest) {
        spell.id = oldest.id;
      } else {
        return;
      }
    }
  }

  if (!spell.kind) {
    spell.kind = isAlignmentSpell(spell) ? "alignment" : "standard";
  }

  const existing = state.spells.find(
    (s) =>
      s.conversationId === convo.id &&
      s.status !== "sent" &&
      (s.id === spell.id || spellsAreSameKindPurpose(s, spell))
  );

  // Sealed casts never reanimate into Active as REBUILT/REFILLED
  // Curiosity: always upgrade ready slot — never stack a new ready after seal of same purpose
  const sealedSame = isCuriositySpell(spell)
    ? null
    : state.spells.find(
        (s) =>
          s.conversationId === convo.id &&
          s.status === "sent" &&
          (s.id === spell.id || spellsAreSameKindPurpose(s, spell))
      );

  let rebuilt = false;
  if (existing) {
    // Upgrade in-place among ACTIVE only — keep id, refresh body against newest intel
    const keepId = existing.id;
    const forgedAt = existing.createdAt || Date.now();
    Object.assign(existing, spell, {
      id: keepId,
      conversationId: convo.id,
      createdAt: forgedAt,
      rebuilt: true,
      rebuiltAt: Date.now(),
      status: "ready",
      sentAt: undefined,
      copiedAt: existing.copiedAt,
      answeredAt: existing.answeredAt,
    });
    rebuilt = true;
  } else if (sealedSame) {
    // New generation for same purpose — history keeps the old CAST card
    // Gate: curiosity never uses this path; self-cast capped above
    spell.rebuilt = false;
    spell.createdAt = spell.createdAt || Date.now();
    spell.status = spell.status || "ready";
    state.spells.push(spell);
  } else {
    spell.rebuilt = false;
    spell.createdAt = spell.createdAt || Date.now();
    spell.status = spell.status || "ready";
    state.spells.push(spell);
  }

  state.spells = dedupeSpells(state.spells);
  // Always enforce curiosity hard cap after any commit
  if (isCuriositySpell(spell)) enforceCuriosityCap(convo);

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
        ? `Spell refilled: ${stored.purpose}`
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
        "Copy → paste to the AI node (or any pertinent node this Focus steers)",
        "Paste full reply here — Focus is the sun/nucleus; intelligence densens back",
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
          /SIGNAL|CAPABILIT|CONSTRAINT|PURPOSE|ALIGNMENT|NEXT THREE|ACTION TAKEN|Pulse:|LOOP RECEIVED|HOLDING FORMATION/i.test(
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
  // Drop active hold/loop garbage so Active stays activation-only
  state.spells = state.spells.filter((s) => {
    if (s.conversationId !== convo.id) return true;
    if (s.status === "sent") return true;
    if (isReceiptSpell(s) || purposeLooksLikeHoldLoop(s.purpose)) return false;
    return true;
  });
  state.spells = dedupeSpells(state.spells || []);
  const purged = Math.max(0, before - state.spells.length);

  const atlas = buildFocusIntelAtlas(convo);
  const lastUser = [...(convo.messages || [])]
    .reverse()
    .find((m) => m.role === "user" && String(m.text || "").trim());
  const lastText = lastUser?.text || "";

  // Smart advance: after a hold/loop densen, forge NEXT THREE MOVES[0] open — not re-maintain frame
  let readyHint = nextTruePriorityHint(convo);
  if (!readyHint) {
    if (isAiNode(convo) && !convoAlignmentUnlocked(convo)) {
      readyHint = "ALIGNMENT REVEAL";
    } else if (isHoldOrLoopReply(lastText)) {
      readyHint =
        "Open next constrained move from NEXT THREE that is not yet in Cast History";
    } else {
      const recent = recentUserIntel(convo, 1)[0];
      if (recent && !purposeLooksLikeHoldLoop(recent) && !isHoldOrLoopReply(recent)) {
        readyHint = recent;
      } else if (isPerson(convo)) {
        readyHint = `Check-in / remembered action for ${convo.name}`;
      } else {
        readyHint = `Next highest-value cast for ${convo.name}`;
      }
    }
  }

  // If top active already matches this hint, don't spam — just surface it
  const existingActive = activeSpellsFor(convo.id).find(
    (s) =>
      normalizePurposeKey(s.purpose) === normalizePurposeKey(readyHint) ||
      purposeLooksLikeHoldLoop(s.purpose) === false &&
        spellsAreSameKindPurpose(s, { purpose: readyHint, kind: "directive" })
  );
  if (
    existingActive &&
    !isHoldOrLoopReply(lastText) &&
    !purposeLooksLikeHoldLoop(existingActive.purpose)
  ) {
    return { spell: existingActive, purged, atlas, readyHint, reused: true };
  }

  const spell = generateAndStoreSpell(convo, readyHint, { silentToast: true });
  // Hard refuse hold loop purposes on Cast Spell path
  if (spell && !spell.blocked && purposeLooksLikeHoldLoop(spell.purpose)) {
    // Retry once with force next-move wording
    const forced =
      nextTruePriorityHint(convo) ||
      "Execute first open NEXT THREE MOVES item not already CAST";
    const retry = generateAndStoreSpell(convo, forced, { silentToast: true });
    if (retry && !retry.blocked && !purposeLooksLikeHoldLoop(retry.purpose)) {
      return { spell: retry, purged, atlas, readyHint: forced };
    }
    return {
      spell: {
        blocked: true,
        reason:
          "Frame already held in Cast History. State a *new* constrained ask, or densen next agenda (Base44 / README / Auth) then Cast Spell.",
      },
      purged,
      atlas,
      readyHint,
    };
  }
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

  // Curiosity densen runs with every Cast Spell (linked nodes → nucleus)
  autoGenerateCuriositySpells(convo, { silentToast: true });

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

async function copySpell(id, { seal = true } = {}) {
  const spell = state.spells.find((s) => s.id === id);
  if (!spell) return;
  const md = formatSpellMarkdown(spell);
  try {
    await navigator.clipboard.writeText(md);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = md;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  spell.copiedAt = Date.now();
  // Automagic cast close: Copy of an active spell == sent into the world
  if (seal && spell.status !== "sent") {
    markSent(id, { fromCopy: true });
  } else {
    persist();
    renderSpells();
    const focus = state.conversations.find((c) => c.id === spell.conversationId);
    const paste = spellPasteHint(spell, focus);
    toast(paste ? `Copied — ${paste}` : "Spell copied", "success");
  }
}

function markSent(id, { fromCopy = false, fromSelfCast = false, silent = false } = {}) {
  const spell = state.spells.find((s) => s.id === id);
  if (!spell) return;
  const now = Date.now();
  spell.status = "sent";
  spell.sentAt = spell.sentAt || now;
  spell.copiedAt = spell.copiedAt || now;
  spell.rebuilt = false;
  if (fromSelfCast) spell.selfCastAt = now;

  // If alignment was sent, nudge user to paste the reply (not for SELF-CAST inject)
  if (isAlignmentSpell(spell) && !fromSelfCast) {
    const convo = state.conversations.find((c) => c.id === spell.conversationId);
    if (convo) {
      convo.messages.push({
        id: uid("msg"),
        role: "grimoire",
        text: `Alignment Reveal sealed to Cast History. When **${spell.target}** replies, paste their reveal here — I'll lock future spells to that frame.`,
        ts: now,
      });
    }
  }

  persist();
  renderSpells();
  renderConvoList();
  renderChat();

  const focus = state.conversations.find((c) => c.id === spell.conversationId);
  if (focus) {
    if (state.activeId === focus.id) {
      universeEvent("sent", {
        spellsSent: historySpellsFor(focus.id).length,
      });
      setFocusUniverse(deriveFocusSnapshot(focus, state.spells), { warp: false });
    }
    syncFocusIntelligenceFile(
      focus,
      fromSelfCast ? "SPELL_SELF_CAST" : "SPELL_SENT",
      `${spell.purpose} ${fromSelfCast ? "SELF-CAST into Focus chat" : "CAST"} via ${spell.medium} at ${new Date(spell.sentAt).toISOString()}`
    );
  }

  if (silent) return;

  if (fromSelfCast) {
    toast("SELF-CAST sealed to Cast History", "success");
    return;
  }

  const paste = spell ? spellPasteHint(spell, focus) : "";
  toast(
    fromCopy
      ? paste
        ? `Copied + sealed — ${paste}`
        : "Copied + sealed to Cast History — paste the reply when it returns"
      : "Spell sealed to Cast History",
    "success"
  );
}

function createConversation({ name, type, archetype, model } = {}) {
  if (!name) return;
  let t = type || archetype || "person";
  if (t !== "ai") t = "person"; // create path is person | ai only
  const rawModel = t === "ai" ? (model || "none") : "none";
  const sealed = t === "ai"
    ? (!rawModel || rawModel === "none" ? "Open" : rawModel)
    : "Open";

  // One Focus = one name + identity (model for AI, open for person)
  if (focusExists(state.conversations, name.trim(), sealed)) {
    toast(`Focus already exists: ${name.trim()} · ${sealed}`);
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

  const bornAt = Date.now();
  const messages = [];
  if (t === "ai") {
    const modelLine = sealed === "Open" ? "Open model" : sealed;
    messages.push({
      id: uid("msg"),
      role: "grimoire",
      text: `AI Focus sealed: **${name.trim()}** (${modelLine}). Speak about this intelligence. Hit **Cast Spell** for Alignment Reveal — then craft words-as-magic for whatever surface you deliver on.`,
      ts: Date.now(),
      kind: "alignment-directive",
    });
  } else {
    messages.push({
      id: uid("msg"),
      role: "grimoire",
      text: `Person Focus sealed: **${name.trim()}**. Speak about them and yourself. Cast Spell crafts communication — medium is open (Discord, text, email, in-person, anything).`,
      ts: Date.now(),
    });
  }

  const convo = {
    id,
    name: name.trim(),
    archetype: t === "ai" ? "wizard" : "person",
    type: t,
    star: randomStarPosition(state.conversations),
    messages,
    createdAt: bornAt,
  };

  applyFocusClassification(convo, {
    type: t,
    model: t === "ai" ? rawModel : undefined,
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
  const sealLabel = getSealedChannel(convo);
  syncFocusIntelligenceFile(
    convo,
    "FOCUS_CREATED",
    `Focus sealed: ${convo.name} · ${sealLabel}`
  );
  toast(`Focus sealed: ${convo.name} · ${sealLabel}`);
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

// Complex spell little chat (spells panel) — separate from main Focus chat
els.littleChatForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!activeConvo()) return;
  const text = (els.littleChatInput?.value || "").trim();
  if (!text) return;
  if (els.littleChatInput) els.littleChatInput.value = "";
  sendLittleChatMessage(text);
});

els.littleChatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.littleChatForm?.requestSubmit();
  }
});

els.btnLittleChatToggle?.addEventListener("click", () => {
  const collapsed = !els.littleChat?.classList.contains("collapsed");
  setLittleChatCollapsed(collapsed);
});

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
  syncNewFocusFormChrome();
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

els.btnToggleSpells?.addEventListener("click", (e) => {
  // With panel already open: cycle Active ↔ Cast History (tap icon again)
  if (state.spellsOpen && !e.shiftKey) {
    setSpellView(ensureSpellView() === "active" ? "history" : "active");
    return;
  }
  toggleSpells();
});
els.btnCloseSpells?.addEventListener("click", () => {
  if (state.spellsOpen) toggleSpells();
});
els.tabSpellsActive?.addEventListener("click", () => setSpellView("active"));
els.tabSpellsHistory?.addEventListener("click", () => setSpellView("history"));

// Universe view — hide AI chat; pure intelligence sky (Focus = nucleus)
els.btnUniverseView?.addEventListener("click", () => toggleUniverseView());
els.btnUniverseViewExit?.addEventListener("click", () => setUniverseView(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.universeView) {
    // Don't steal Esc from open modals/atlas
    if (els.universeLegend && !els.universeLegend.hasAttribute("hidden")) return;
    if (els.appSettingsPanel && !els.appSettingsPanel.hasAttribute("hidden")) return;
    if (els.dialog?.open) return;
    e.preventDefault();
    setUniverseView(false);
  }
});

// "+ New Focus" — always available; also handle clicks even if DOM re-queries
function bindNewFocusButton() {
  const btn = document.getElementById("btn-new-convo") || els.btnNew;
  if (!btn || btn.dataset.boundNewFocus === "1") return;
  btn.dataset.boundNewFocus = "1";
  btn.style.position = "relative";
  btn.style.zIndex = "50";
  btn.style.pointerEvents = "auto";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    console.log("[NewFocus] click handler fired");
    try {
      openNewFocusModal({ name: "", type: "person", channel: "Discord" });
      console.log("[NewFocus] openNewFocusModal returned without throwing");
    } catch (err) {
      console.error("[NewFocus] openNewFocusModal threw", err);
    }
    // Always attempt visible open regardless of try/catch outcome
    requestAnimationFrame(() => {
      console.log("[NewFocus] post-RAF dialog state", {
        dialogExists: !!els.dialog,
        dialogTag: els.dialog?.tagName,
        dialogOpen: els.dialog?.open,
        dialogHasAttrOpen: els.dialog?.hasAttribute?.("open"),
      });
      try {
        if (!els.dialog) return;
        if (typeof els.dialog.showModal === "function") {
          els.dialog.showModal();
          console.log("[NewFocus] used showModal()");
        } else if (typeof els.dialog.show === "function") {
          els.dialog.show();
          console.log("[NewFocus] used show()");
        } else {
          els.dialog.setAttribute("open", "");
          console.log("[NewFocus] used setAttribute(open)");
        }
      } catch (err) {
        console.error("[NewFocus] post-RAF open failed", err);
      }
    });
  });
}
bindNewFocusButton();
// Safety net: delegated click in case of dynamic re-render issues
document.addEventListener("click", (e) => {
  const btn = e.target?.closest?.("#btn-new-convo");
  if (!btn) return;
  // only if direct listener somehow mis-bound
  if (btn.dataset.boundNewFocus !== "1") {
    e.preventDefault();
    try {
      showNewFocusModal({ name: "", type: "person", channel: "Discord" });
    } catch {}
  }
}, true);

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
  const type = els.newType?.value === "ai" ? "ai" : "person";
  const model = type === "ai" ? (els.newModel?.value || "none") : "none";
  createConversation({ name, type, model });
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

// Universe Engine — canvas cosmos behind HUD (force starfield on boot)
if (els.universeCanvas) {
  initUniverse(els.universeCanvas, {
    onHud: (info) => {
      // Live star fill + temporal densen (age / vault progress)
      if (els.universeHudCount) els.universeHudCount.textContent = String(info.starCount || 0);
      if (els.universeHudStage) {
        const stageName = info.stageName || "VOID";
        const densenPct = Math.round(Math.max(0, Math.min(1, info.densenProgress || 0)) * 100);
        const densenBit = densenPct > 0 ? ` · densen ${densenPct}%` : "";
        const ageBit = info.ageLabel ? ` · age ${info.ageLabel}` : "";
        els.universeHudStage.textContent = `${stageName}${densenBit}${ageBit}`;
      }
    },
  });
  // Immediate void sky before Focus snapshot — never black frame
  setFocusUniverse(null, { warp: false });
}

els.universeHud?.addEventListener("click", () => {
  toggleAtlas();
});
els.btnAtlasClose?.addEventListener("click", () => setAtlasOpen(false));

if (!state.spellsOpen) els.app.classList.add("spells-collapsed");
applySidebarCollapsed(loadSidebarCollapsed());
applyUniverseViewMode();
setLittleChatCollapsed(loadLittleChatCollapsed());
// Silent merge of kind+purpose duplicates on load
state.spells = dedupeSpells(
  (state.spells || []).filter((s) => !isReceiptSpell(s))
);
// Boot: auto-generate curiosity spells for active Focus (if unlocked + has links)
{
  const bootFocus = activeConvo();
  if (bootFocus) autoGenerateCuriositySpells(bootFocus, { silentToast: true });
}
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
