/**
 * Grimoire MVP — core loop (GBG: Grimoire Builds Grimoire)
 *
 * AI nodes: alignment-first → then auto-spell on intent
 * Person/network: conversational + auto-propose spells when intent is clear
 * Cast Spell still works; Grimoire also initiates without waiting.
 */

window.__GrimoireErrors = [];
window.__grimoireOriginalError = window.onerror;
window.onerror = function(message, url, line, col, error) {
  window.__GrimoireErrors.push({ message, url, line, col, stack: error && error.stack ? error.stack : null });
  if (console && console.error) console.error("[grimoire-global] " + message, { url, line, col, stack: error && error.stack });
  if (window.__grimoireOriginalError) return window.__grimoireOriginalError(message, url, line, col, error);
  return true;
};
window.addEventListener("unhandledrejection", function(ev) {
  var reason = ev.reason;
  window.__GrimoireErrors.push({ unhandledRejection: reason, stack: reason && reason.stack });
  if (console && console.error) console.error("[grimoire-global] unhandledrejection", reason);
});
import {
  applyFocusClassification,
  DEFAULT_FOCUS_FOLDERS,
  ensureFocusOrgFields,
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
  STORAGE_KEY,
  suggestFocusFolderId,
  ensureScrollFocus,
  ensureCell2CoreFocus,
  isCell2CoreFocus,
  isVisibleFocus,
  CELL2_CORE_ID,
  CELL2_CORE_NAME,
  ensureCertainty,
  classifyIntelCategory,
  normalizeCertainty,
  parseBusCommand,
  makeBusMessage,
  resolveBusChannel,
  BUS_CHANNEL_ROUTES,
} from "./data.js?v=per-focus-vault-1";
import {
  randomStarPosition,
  updateConstellation,
  setFocusMetrics,
  liveCapture,
} from "./stars.js?v=per-focus-vault-1";
import {
  initUniverse,
  setFocusUniverse,
  deriveFocusSnapshot,
  universeEvent,
  getUniverseHud,
  universeStage,
} from "./universe.js?v=per-focus-vault-1";
import {
  chooseIntelligenceFolder,
  chooseFocusIntelligenceFolder,
  ensureIntelligenceFolder,
  writeFocusIntelligence,
  recordFocusEvent,
  deleteFocusIntelligenceFile,
  getFolderLabel,
  hasDirectoryPicker,
  wasIntelligenceSetupSkipped,
  isIntelligenceSetupComplete,
  isFocusVaultLinked,
  resolveFocusFolderHandle,
  setFocusFolderHandle,
  focusVaultFolderName,
  focusFileName,
  buildFocusMarkdown,
  buildScrollList,
  appendCell2Intelligence,
  appendEntityIntelligence,
  readCell2IntelligenceLog,
  readEntityIntelligence,
  ensureCell2IntelligenceFile,
  updateScrollListIndex,
  saveEntityImage,
  classifyCell2Kind,
  entityIntelPath,
  entityIdFromFocus,
  CELL2_KINDS,
  CELL2_INTEL_PATH,
  SCROLL_LIST_FILE,
  readScrollListNodes,
  resolveScrollNode,
  registerBusNode,
  densenBusMessage,
  searchBusLocal,
  relayIntelBetweenFocuses,
  getBusActivityLog,
  pushBusActivity,
  buildScrollNodesFromConversations,
} from "./intelligence.js?v=per-focus-vault-1";
import {
  computeFocusHealth,
  healthHudChip,
  healerHealthSpellHint,
} from "./health.js?v=per-focus-vault-1";

const SIDEBAR_COLLAPSE_KEY = "grimoire-sidebar-collapsed-v1";
const UNIVERSE_VIEW_KEY = "grimoire-universe-view-v1";

// ─── State ───

const state = loadState();
// Silent migration: strip archetype from existing conversations (legacy purge)
for (const c of state.conversations || []) {
  if ("archetype" in c) delete c.archetype;
  ensureCertainty(c);
}
// Per-focus vault: restore vaultLinked flags from LS keys (never suppress via global vault)
try {
  for (const c of state.conversations || []) {
    if (isCell2CoreFocus(c) || !c?.id) continue;
    if (typeof isFocusVaultLinked === "function" && isFocusVaultLinked(c.id)) {
      c.vaultLinked = true;
      c.needsPathOnboarding = false;
    } else if (c.vaultLinked && !c.pathOnboardingDismissed) {
      // Legacy: had vaultLinked from old global gate — re-enable onboarding
      // unless user already dismissed or per-focus handle exists
      c.vaultLinked = false;
      if (c.needsPathOnboarding == null) c.needsPathOnboarding = true;
    }
  }
} catch {
  /* ignore */
}
// SCROLL eternal-intelligence Focus (idempotent seed after load)
ensureScrollFocus(state);
// Cell2 Core — app self-intelligence engine (idempotent system seed)
ensureCell2CoreFocus(state);
// Focus org UI (search is ephemeral; folders + pin/tags persist via saveState)
if (!Array.isArray(state.focusFolders) || !state.focusFolders.length) {
  state.focusFolders = structuredClone(DEFAULT_FOCUS_FOLDERS);
}
for (const c of state.conversations || []) {
  ensureFocusOrgFields(c, { assignFolder: true });
}
/** Live search query for FOCUSES panel (not persisted). */
state.focusSearchQuery = "";
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
    state.activeId = null;
    persist();
  }
})();

// ─── DOM ───

const $ = (sel) => document.querySelector(sel);

const els = {
  sidebar: $("#sidebar"),
  btnSidebarToggle: $("#btn-sidebar-toggle"),
  convoList: $("#convo-list"),
  focusSearch: $("#focus-search"),
  focusSearchCount: $("#focus-search-count"),
  focusOrgToolbar: $("#focus-org-toolbar"),
  btnNewFolder: $("#btn-new-folder"),
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
  vaultFailDot: $("#vault-fail-dot"),
  intelFolderStatus: $("#intel-folder-status"),
  brandText: $("#brand-text"),
  spellCount: $("#spell-count") || document.getElementById("spell-count"),
  spellsList: $("#spells-list"),
  spellsHint: $("#spells-hint"),
  tabSpellsActive: $("#tab-spells-active"),
  tabSpellsHistory: $("#tab-spells-history"),
  complexCraftDialog: $("#complex-craft-dialog"),
  btnComplexCraftClose: $("#btn-complex-craft-close"),
  complexCraftSub: $("#complex-craft-sub"),
  littleChatMessages: $("#little-chat-messages"),
  littleChatForm: $("#little-chat-form"),
  littleChatInput: $("#little-chat-input"),
  btnLittleChatSend: $("#btn-little-chat-send"),
  btnSpellsTitle: $("#btn-spells-title"),
  spellsTitleMenu: $("#spells-title-menu"),
  btnCraftComplexSpell: $("#btn-craft-complex-spell"),
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
  editDialog: $("#edit-convo-dialog"),
  editId: $("#edit-entity-id"),
  editName: $("#edit-entity-name"),
  editTypeLabel: $("#edit-entity-type-label"),
  editModelLabel: $("#edit-model-label"),
  btnCancelEdit: $("#btn-cancel-edit"),
  btnEditFocus: $("#btn-edit-focus"),
  btnCopyScrollList: $("#btn-copy-scroll-list"),
  appSettingsPanel: $("#app-settings-panel"),
  btnAppSettings: $("#btn-app-settings"),
  btnAppSettingsClose: $("#btn-app-settings-close"),
  galleryDialog: $("#gallery-dialog"),
  galleryBody: $("#gallery-body"),
  btnGalleryClose: $("#btn-gallery-close"),
  btnOpenGallery: $("#btn-open-gallery"),
  btnBrain: $("#btn-brain"),
  brainOverlay: $("#brain-overlay"),
  brainBody: $("#brain-body"),
  brainSub: $("#brain-sub"),
  btnBrainClose: $("#btn-brain-close"),
  busStatus: $("#bus-status"),
  busStatusValue: $("#bus-status-value"),
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
  const c = state.conversations.find((x) => x.id === state.activeId) || null;
  // Cell2 Core is system substrate — never the active chat focus
  if (c && isCell2CoreFocus(c)) {
    const vis = state.conversations.find((x) => isVisibleFocus(x));
    if (vis) state.activeId = vis.id;
    return vis || null;
  }
  return c;
}

function spellsFor(convoId) {
  return state.spells
    .filter((s) => s.conversationId === convoId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Single source of truth: has this spell left the Active queue?
 * Badge · Active tab · Cast History · pendingCount must all use this.
 *
 * Sealed = status "sent" OR any cast lifecycle stamp (sentAt/answeredAt/selfCastAt/copiedAt).
 * Refill clears those stamps and sets status "ready" — only then is it active again.
 * Never treat rebuiltAt alone as active (that inflated button badge toward total).
 */
function spellIsSealed(spell) {
  if (!spell) return true;
  const st = String(spell.status || "").toLowerCase();
  if (st === "sent") return true;
  // Any lifecycle stamp = functionally cast (even if status lagged)
  if (spell.sentAt || spell.answeredAt || spell.selfCastAt || spell.copiedAt) {
    return true;
  }
  return false;
}

/** True when spell belongs in Active (CAST THIS / hold) queue. */
function spellIsActiveQueue(spell) {
  if (!spell) return false;
  if (spellIsSealed(spell)) return false;
  if (isReceiptSpell(spell)) return false;
  if (typeof purposeLooksLikeHoldLoop === "function" && purposeLooksLikeHoldLoop(spell.purpose)) {
    return false;
  }
  return true;
}

/**
 * Active-ready count only — NEVER total spells for a Focus.
 * Same sealed-aware predicate Scroll specified for the spell button badge.
 */
function activeReadyCount(convoId) {
  if (!convoId) return 0;
  return (state.spells || []).filter(
    (s) => s.conversationId === convoId && !spellIsSealed(s) && spellIsActiveQueue(s)
  ).length;
}

/**
 * Promote lagged lifecycle → status:"sent" so localStorage stops re-leaking badges.
 * Also strip cast stamps from refilled cards so Active stays clean.
 * Returns true if any spell mutated.
 */
function healSpellLifecycles(spells = state.spells) {
  let changed = false;
  for (const s of spells || []) {
    if (!s) continue;

    // Refilled generation: strip cast stamps; force back to ready if needed
    if (s.rebuilt || s.rebuiltAt) {
      if (String(s.status || "").toLowerCase() === "sent") {
        s.status = "ready";
        changed = true;
      }
      if (s.sentAt || s.answeredAt || s.selfCastAt || s.copiedAt) {
        s.sentAt = undefined;
        s.answeredAt = undefined;
        s.selfCastAt = undefined;
        s.copiedAt = undefined;
        changed = true;
      }
      continue;
    }

    if (String(s.status || "").toLowerCase() === "sent") continue;
    if (!spellIsSealed(s)) continue;

    s.status = "sent";
    s.sentAt = s.sentAt || s.answeredAt || s.selfCastAt || s.copiedAt || Date.now();
    s.copiedAt = s.copiedAt || s.sentAt;
    changed = true;
  }
  return changed;
}

/** Active queue only — never cast / history / receipt / hold-loop sludge. */
function activeSpellsFor(convoId) {
  return spellsFor(convoId)
    .filter((s) => spellIsActiveQueue(s))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Cast History — sealed casts, newest answer first. */
function historySpellsFor(convoId) {
  return spellsFor(convoId)
    .filter((s) => spellIsSealed(s) && !isReceiptSpell(s))
    .sort((a, b) => (b.sentAt || b.answeredAt || b.createdAt || 0) - (a.sentAt || a.answeredAt || a.createdAt || 0));
}

function pendingCount(convoId) {
  // Same bucket as Active tab / top spell button — never total history
  return activeReadyCount(convoId);
}

/**
 * Write active-ready N into #spell-count (top spell button).
 * Never total spells. Never Cast History length. 0 → hide.
 */
function setSpellButtonBadge(activeReady) {
  const n = Math.max(0, Number(activeReady) || 0);
  const countEl =
    els.spellCount ||
    document.getElementById("spell-count") ||
    document.querySelector("#btn-toggle-spells .spell-count");
  if (!countEl) return;
  countEl.textContent = n > 0 ? String(n) : "";
  countEl.dataset.count = String(n);
  countEl.title =
    n > 0 ? `${n} ready spell${n === 1 ? "" : "s"} (Active queue)` : "No ready spells";
}

/**
 * Header + sidebar badge MUST equal Active-tab card count for this Focus.
 * Call after heal + activeSpellsFor so numbers never drift.
 */
function syncSpellCountBadges(focusId, readyCount) {
  // Ignore caller if they pass total-by-mistake — recompute from ACTIVE predicate
  const n =
    focusId != null
      ? activeReadyCount(focusId)
      : Math.max(0, Number(readyCount) || 0);

  setSpellButtonBadge(n);

  // Only rewrite the active Focus row (other focuses keep their own pending)
  if (!focusId || focusId !== state.activeId) return;
  const row = document.querySelector(`.convo-item[data-focus-id="${focusId}"]`);
  if (!row) return;
  const main = row.querySelector(".convo-item-main");
  if (!main) return;

  let badge = main.querySelector(".convo-badge");
  if (n > 0) {
    if (!badge) {
      badge = document.createElement("span");
      main.appendChild(badge);
    }
    badge.className = "convo-badge";
    badge.title = `${n} ready spell${n === 1 ? "" : "s"}`;
    badge.textContent = String(n);
  } else {
    main.querySelectorAll(".convo-badge:not(.unread)").forEach((el) => el.remove());
  }
}

/**
 * Force top-right + every sidebar Focus badge from ACTIVE-ready only
 * (never total spellsFor length). Call at end of renderSpells after heal.
 */
function syncFocusBadges() {
  const activeId = state.activeId || null;
  // Scroll spec: conversationId match + !spellIsSealed (+ Active queue filters)
  const activeReady = activeId
    ? (state.spells || []).filter(
        (s) => s.conversationId === activeId && !spellIsSealed(s) && spellIsActiveQueue(s)
      ).length
    : 0;

  setSpellButtonBadge(activeReady);

  document.querySelectorAll(".convo-item[data-focus-id]").forEach((row) => {
    const focusId = row.dataset.focusId;
    if (!focusId) return;
    const n = activeReadyCount(focusId);
    const main = row.querySelector(".convo-item-main");
    if (!main) return;

    if (n > 0) {
      let badge = main.querySelector(".convo-badge");
      if (!badge) {
        badge = document.createElement("span");
        main.appendChild(badge);
      }
      badge.className = "convo-badge";
      badge.title = `${n} ready spell${n === 1 ? "" : "s"}`;
      badge.textContent = String(n);
    } else {
      // Empty Active queue → drop numeric spell badge (keep .unread message chips)
      main.querySelectorAll(".convo-badge:not(.unread)").forEach((el) => el.remove());
    }
  });
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

  // Prefer unanswered ENGAGE casts first (proactive node loop densen)
  const hist = historySpellsFor(convo.id);
  const newest =
    hist.find((s) => !s.answeredAt && isNodeEngageSpell(s)) ||
    hist.find((s) => !s.answeredAt);
  if (!newest) return;
  newest.answeredAt = Date.now();
  newest.answerExcerpt = t.replace(/\s+/g, " ").trim().slice(0, 280);
  // Knowledge update: sealed engage + returned intel → SCROLL LIST / vault
  densenScrollListFromEngage(convo, newest, t);
  void writeScrollListToVault(convo);
}

function persist() {
  // Keep org timestamps fresh on active focus when content mutates
  const active = activeConvo();
  if (active) {
    ensureFocusOrgFields(active, { assignFolder: false });
  }
  saveState(state);
}

/** Mark Focus as recently updated (list timestamps / sort signals). */
function touchFocus(convo) {
  if (!convo) return;
  ensureFocusOrgFields(convo, { assignFolder: false });
  convo.updatedAt = Date.now();
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

// ─── Render: sidebar (search + folders + pin + DnD + indicators) ───

/** Last activity timestamp for a Focus (messages, spells, updatedAt). */
function focusLastUpdated(convo) {
  if (!convo) return 0;
  let maxTs = Number(convo.updatedAt || convo.createdAt || 0) || 0;
  for (const m of convo.messages || []) {
    const t = Number(m.ts || m.createdAt || 0);
    if (t > maxTs) maxTs = t;
  }
  for (const s of state.spells || []) {
    if (s.conversationId !== convo.id) continue;
    const t = Number(s.sentAt || s.createdAt || 0);
    if (t > maxTs) maxTs = t;
  }
  return maxTs;
}

/** Relative time chip — compact for sidebar. */
function formatRelativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - Number(ts);
  if (diff < 0) return "now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.floor(day / 30);
  return `${mo}mo`;
}

/** Unread message count (messages after lastViewedAt, excluding active focus). */
function unreadCount(convo) {
  if (!convo || convo.id === state.activeId) return 0;
  const last = Number(convo.lastViewedAt || 0) || 0;
  return (convo.messages || []).filter((m) => {
    if (!m) return false;
    if (m.role === "system" || m.kind === "focus-suggestion") return false;
    const t = Number(m.ts || m.createdAt || 0);
    return t > last;
  }).length;
}

/** Linked node count for indicator (sibling focuses / ecosystem). */
function linkedNodeCount(convo) {
  if (!convo) return 0;
  const sameName = (state.conversations || []).filter(
    (f) => f.id !== convo.id && String(f.name || "").toLowerCase() === String(convo.name || "").toLowerCase()
  ).length;
  const others = Math.max(0, (state.conversations || []).length - 1);
  // Prefer same-name dual-channel count; fall back to thin ecosystem signal
  return sameName || Math.min(others, 6);
}

/**
 // Instant live filter: name, sealed node/channel, type, tags, keywords.
 */
function focusMatchesSearch(convo, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  if (!convo) return false;
  const channel = getSealedChannel(convo);
  const type = getFocusType(convo);
  const tags = (convo.tags || []).join(" ");
  const hay = [
    convo.name,
    channel,
    type,
    convo.backend,
    convo.medium,
    convo.model,
    convo.aiSubtype,
    tags,
    sealedChannelLabel(convo),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(q)) return true;
  // Multi-token: all tokens must match somewhere
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => hay.includes(t))) return true;
  // Keyword scan recent user/grimoire messages (light)
  const msgs = (convo.messages || []).slice(-12);
  for (const m of msgs) {
    if (String(m.text || "").toLowerCase().includes(q)) return true;
  }
  return false;
}

function getSortedFocusFolders() {
  const folders = Array.isArray(state.focusFolders) ? state.focusFolders : [];
  return [...folders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function sortFocusesForDisplay(list) {
  return [...list].sort((a, b) => {
    const pinA = a.pinned ? 1 : 0;
    const pinB = b.pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    // Preserve array order (operator drag order) as stable secondary
    const ia = state.conversations.indexOf(a);
    const ib = state.conversations.indexOf(b);
    return ia - ib;
  });
}

window.__renderConvoList = renderConvoList;
function renderConvoList() {
  console.debug("[sidebar] render start", {
    convoList: !!els.convoList,
    conversations: (state.conversations || []).length,
    activeId: state.activeId,
    query: state.focusSearchQuery,
  });
  if (!els.convoList) {
    console.warn("[sidebar] els.convoList missing");
    return;
  }
  try { els.convoList.innerHTML = ""; } catch (e) { console.warn("[sidebar] innerHTML clear failed", e); }

  const query = state.focusSearchQuery || "";
  // Cell2 Core is system substrate — never show in sidebar
  const all = (state.conversations || []).filter((c) => isVisibleFocus(c));
  const matched = all.filter((c) => focusMatchesSearch(c, query));
  console.debug("[sidebar] matched", matched.map((c) => c.id + "::" + c.name));
  const searching = Boolean(String(query).trim());

  if (els.focusSearchCount) {
    if (searching) {
      els.focusSearchCount.hidden = false;
      els.focusSearchCount.textContent = matched.length + "/" + all.length;
    } else {
      els.focusSearchCount.hidden = true;
      els.focusSearchCount.textContent = "";
    }
  }

  if (!matched.length) {
    const empty = document.createElement("div");
    empty.className = "focus-list-empty";
    empty.textContent = searching ? "No focuses match" : "No focuses yet";
    els.convoList.appendChild(empty);
    console.debug("[sidebar] empty state rendered");
    return;
  }

  const pinned = matched.filter((c) => c.pinned);
  const unpinned = matched.filter((c) => !c.pinned);
  if (pinned.length && !String(query).trim()) {
    const pinHeader = document.createElement("div");
    pinHeader.className = "focus-group-header focus-group-pinned";
    pinHeader.innerHTML = '<span class="focus-group-name">★ Pinned</span><span class="focus-group-count">' + pinned.length + "</span>";
    els.convoList.appendChild(pinHeader);
    for (const c of pinned) els.convoList.appendChild(buildFocusRow(c));
  }
  const flat = sortFocusesForDisplay(unpinned.length ? unpinned : matched);
  console.debug("[sidebar] appending rows", flat.map((c) => c.id + "::" + c.name));
  for (const c of flat) {
    try {
      els.convoList.appendChild(buildFocusRow(c));
      // Path onboarding callout sits directly under the fresh focus row
      if (focusNeedsPathOnboarding(c)) {
        els.convoList.appendChild(buildPathOnboardingCallout(c));
      }
    } catch (e) {
      console.warn("[sidebar] row append failed", c.id, e);
    }
  }
  console.debug("[sidebar] render end", { rows: flat.length });
}

/** Per-focus vault linked? (never gate on global vault) */
function isFocusPathLinked(c) {
  if (!c?.id) return false;
  if (c.vaultLinked === true) return true;
  try {
    return Boolean(isFocusVaultLinked(c.id));
  } catch {
    return false;
  }
}

/**
 * Fresh focus still needs path onboarding until THIS focus links its folder
 * or user dismisses. Global vault does NOT suppress this.
 */
function focusNeedsPathOnboarding(c) {
  if (!c || !isVisibleFocus(c) || isCell2CoreFocus(c)) return false;
  if (c.pathOnboardingDismissed) return false;
  if (isFocusPathLinked(c)) return false;
  // Explicit flag from createConversation, or legacy focuses with no path yet
  if (c.needsPathOnboarding === true) return true;
  if (c.needsPathOnboarding === false) return false;
  // Existing focuses without a per-focus handle → show callout
  return !isFocusPathLinked(c);
}

/** Subtle glow while path onboarding is active. */
function focusShowsFreshHighlight(c) {
  if (focusNeedsPathOnboarding(c)) return true;
  if (!c || !isVisibleFocus(c) || isCell2CoreFocus(c)) return false;
  if (c.pathOnboardingDismissed || isFocusPathLinked(c)) return false;
  if (c.needsPathOnboarding !== true) return false;
  const age = Date.now() - Number(c.createdAt || 0);
  return age >= 0 && age < 60_000;
}

function focusIsVaultBacked(c) {
  if (!c || isCell2CoreFocus(c)) return false;
  return isFocusPathLinked(c);
}

function dismissPathOnboarding(focusId) {
  const c = state.conversations.find((x) => x.id === focusId);
  if (!c) return;
  c.pathOnboardingDismissed = true;
  c.needsPathOnboarding = false;
  persist();
  renderConvoList();
}

/** Mark a single focus as vault-backed after its own folder is chosen. */
function markFocusVaultLinked(focusId) {
  const c = state.conversations.find((x) => x.id === focusId);
  if (!c) return;
  c.vaultLinked = true;
  c.needsPathOnboarding = false;
  c.pathOnboardingDismissed = true;
}

function buildPathOnboardingCallout(c) {
  const box = document.createElement("div");
  box.className = "focus-path-callout";
  box.dataset.focusId = c.id;
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", `Vault path for ${c.name}`);
  const folderHint = focusVaultFolderName(c.name || c.id);

  box.innerHTML = `
    <button type="button" class="focus-path-dismiss" title="Dismiss" aria-label="Dismiss path callout">×</button>
    <div class="focus-path-callout-body">
      <p class="focus-path-text">Link vault folder to write intelligence<br><span class="focus-path-folder-hint">Creates <code>${escapeHtml(folderHint)}/</code></span></p>
      <button type="button" class="btn-path-link" data-action="link-path">Create my path</button>
    </div>
  `;

  box.querySelector(".focus-path-dismiss")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismissPathOnboarding(c.id);
  });
  box.querySelector('[data-action="link-path"]')?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    state.activeId = c.id;
    persist();
    await onChooseFocusPath(c);
  });

  return box;
}

/**
 * Per-focus "Create my path" — user gesture → picker → <Name>-FocusIntelligence/
 */
async function onChooseFocusPath(focus) {
  if (!focus?.id) return;
  if (!hasDirectoryPicker()) {
    toast("Use Chrome or Edge for on-disk vault writes", "");
    return;
  }
  try {
    const handle = await chooseFocusIntelligenceFolder(focus);
    setVaultFailState(false);
    markFocusVaultLinked(focus.id);
    toast(`Path ready: ${handle.name}/`, "success");
    activityPing(`✦ Focus vault: ${handle.name}/`);
    await refreshIntelFolderUi();
    persist();
    renderConvoList();
    renderChat();
  } catch (err) {
    if (err?.name === "AbortError") {
      renderConvoList();
      return;
    }
    console.warn(err);
    setVaultFailState(true);
    toast("Could not open folder", "");
    renderConvoList();
  }
}

function buildFocusRow(c) {
  /* archetype removed */
  const pending = pendingCount(c.id);
  const unread = unreadCount(c);
  const channel = getSealedChannel(c);
  const ft = getFocusType(c);
  const typeTag =
    ft === "ai"
      ? "AI"
      : ft === "network"
        ? "Network"
        : ft === "eternal-intelligence"
          ? "eternal-intelligence"
          : "Person";
  const updated = focusLastUpdated(c);
  const rel = formatRelativeTime(updated);
  const links = linkedNodeCount(c);
  const tags = Array.isArray(c.tags) ? c.tags : [];
  const fresh = focusShowsFreshHighlight(c);
  const needsPath = focusNeedsPathOnboarding(c);
  const vaultBacked = focusIsVaultBacked(c);

  const row = document.createElement("div");
  row.className =
    "convo-item" +
    (c.id === state.activeId ? " active" : "") +
    (c.pinned ? " pinned" : "") +
    (fresh || needsPath ? " focus-fresh" : "") +
    (needsPath ? " focus-needs-path" : "") +
    (vaultBacked ? " focus-vault-backed" : "");
  row.setAttribute("role", "listitem");
  row.dataset.focusId = c.id;
  row.draggable = true;
  if (needsPath) row.dataset.needsPath = "1";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "convo-item-main";
  const tagStr = tags.length ? ` · ${tags.join(", ")}` : "";
  btn.title = `${c.name} · ${channel} (sealed)${tagStr}${rel ? ` · updated ${rel}` : ""}${
    vaultBacked ? " · vault-backed" : needsPath ? " · link vault to write intelligence" : ""
  }`;

  // Spell badge first (same truth as Active tab / top-right count).
  // Unread is a secondary dim chip so it never masquerades as ready spells.
  const badgeParts = [];
  if (pending > 0) {
    badgeParts.push(
      `<span class="convo-badge" title="${pending} ready spell${pending === 1 ? "" : "s"}">${pending}</span>`
    );
  } else if (unread > 0) {
    badgeParts.push(
      `<span class="convo-badge unread" title="${unread} unread message${unread === 1 ? "" : "s"}">${unread}</span>`
    );
  }

  const tagsHtml = tags.length
    ? `<span class="convo-tags">${tags
        .slice(0, 3)
        .map((t) => `<span class="convo-tag">${escapeHtml(t)}</span>`)
        .join("")}</span>`
    : "";

  const vaultIcon = vaultBacked
    ? `<span class="convo-vault-icon" title="Vault-backed — intelligence writes to disk" aria-label="Vault-backed">📁</span>`
    : "";
  const freshArrow =
    needsPath || fresh
      ? `<span class="convo-fresh-arrow" title="New focus" aria-hidden="true">➜</span>`
      : "";

  btn.innerHTML = `
    <span class="convo-icon" aria-hidden="true">✧</span>
    <span class="convo-text">
      <span class="convo-name-row">
        ${c.pinned ? `<span class="convo-pin-mark" title="Pinned" aria-hidden="true">★</span>` : ""}
        ${freshArrow}
        <span class="convo-name">${escapeHtml(c.name)}</span>
        ${vaultIcon}
      </span>
      <span class="convo-channel-tag">${escapeHtml(channel)}</span>
      <span class="convo-meta">
        <span>${escapeHtml(typeTag)}</span>
        ${rel ? `<span class="convo-updated" title="Last updated">${escapeHtml(rel)}</span>` : ""}
        ${links > 0 ? `<span class="convo-links" title="Linked nodes">⬡${links}</span>` : ""}
      </span>
      ${tagsHtml}
    </span>
    ${badgeParts.join("")}
  `;
  btn.addEventListener("click", () => selectConvo(c.id));

  const actions = document.createElement("div");
  actions.className = "focus-row-actions";

  const pinBtn = document.createElement("button");
  pinBtn.type = "button";
  pinBtn.className = "focus-action-btn" + (c.pinned ? " on" : "");
  pinBtn.title = c.pinned ? "Unpin focus" : "Pin / favorite";
  pinBtn.setAttribute("aria-label", c.pinned ? `Unpin ${c.name}` : `Pin ${c.name}`);
  pinBtn.textContent = c.pinned ? "★" : "☆";
  pinBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleFocusPinned(c.id);
  });

  const tagBtn = document.createElement("button");
  tagBtn.type = "button";
  tagBtn.className = "focus-action-btn";
  tagBtn.title = "Edit tags";
  tagBtn.setAttribute("aria-label", `Tags for ${c.name}`);
  tagBtn.textContent = "#";
  tagBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    editFocusTags(c.id);
  });

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "focus-action-btn";
  exportBtn.title = "Export dossier (.md)";
  exportBtn.setAttribute("aria-label", `Export dossier for ${c.name}`);
  exportBtn.textContent = "⇩";
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    exportFocusDossier(c.id);
  });

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

  actions.appendChild(pinBtn);
  actions.appendChild(tagBtn);
  actions.appendChild(exportBtn);
  actions.appendChild(del);

  row.appendChild(btn);
  row.appendChild(actions);
  wireFocusDrag(row, c);
  return row;
}

// ─── Focus org: pin / tags / folders / search / DnD / export ───

function toggleFocusPinned(focusId) {
  const focus = state.conversations.find((c) => c.id === focusId);
  if (!focus) return;
  ensureFocusOrgFields(focus, { assignFolder: false });
  focus.pinned = !focus.pinned;
  focus.updatedAt = Date.now();
  persist();
  renderConvoList();
  toast(focus.pinned ? `Pinned ${focus.name}` : `Unpinned ${focus.name}`, "success");
}

function editFocusTags(focusId) {
  const focus = state.conversations.find((c) => c.id === focusId);
  if (!focus) return;
  ensureFocusOrgFields(focus, { assignFolder: false });
  const current = (focus.tags || []).join(", ");
  const next = window.prompt(
    `Tags for ${focus.name} (comma-separated)\nSearchable keywords.`,
    current
  );
  if (next === null) return;
  focus.tags = next
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  focus.updatedAt = Date.now();
  persist();
  renderConvoList();
  toast(focus.tags.length ? `Tags: ${focus.tags.join(", ")}` : "Tags cleared", "success");
}

function toggleFolderCollapsed(folderId) {
  const folder = (state.focusFolders || []).find((f) => f.id === folderId);
  if (!folder) return;
  folder.collapsed = !folder.collapsed;
  persist();
  renderConvoList();
}

function renameFocusFolder(folderId) {
  const folder = (state.focusFolders || []).find((f) => f.id === folderId);
  if (!folder) return;
  const next = window.prompt("Rename group", folder.name);
  if (next === null) return;
  const name = next.trim();
  if (!name) return;
  folder.name = name.slice(0, 48);
  persist();
  renderConvoList();
  toast(`Group renamed: ${folder.name}`, "success");
}

function deleteFocusFolder(folderId) {
  const folder = (state.focusFolders || []).find((f) => f.id === folderId);
  if (!folder) return;
  const ok = window.confirm(
    `Delete group “${folder.name}”?\n\nFocuses inside become Ungrouped. Focuses themselves are not deleted.`
  );
  if (!ok) return;
  state.focusFolders = (state.focusFolders || []).filter((f) => f.id !== folderId);
  for (const c of state.conversations || []) {
    if (c.folderId === folderId) c.folderId = null;
  }
  persist();
  renderConvoList();
  toast(`Group removed: ${folder.name}`, "success");
}

function createFocusFolder() {
  const name = window.prompt("New folder / group name", "");
  if (name === null) return;
  const trimmed = name.trim().slice(0, 48);
  if (!trimmed) return;
  if (!Array.isArray(state.focusFolders)) state.focusFolders = [];
  const id = `folder-${trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "group"}-${Date.now().toString(36).slice(-4)}`;
  const order = state.focusFolders.reduce((m, f) => Math.max(m, f.order ?? 0), -1) + 1;
  state.focusFolders.push({ id, name: trimmed, collapsed: false, order });
  persist();
  renderConvoList();
  toast(`Group created: ${trimmed}`, "success");
}

function moveFocusToFolder(focusId, folderId) {
  const focus = state.conversations.find((c) => c.id === focusId);
  if (!focus) return;
  ensureFocusOrgFields(focus, { assignFolder: false });
  const next = folderId || null;
  if (focus.folderId === next) return;
  focus.folderId = next;
  focus.updatedAt = Date.now();
  persist();
  renderConvoList();
}

/**
 * Reorder conversations array so `focusId` sits before `beforeId`
 * (or at end if beforeId is null). Keeps drag order as source of truth.
 */
function reorderFocuses(focusId, beforeId, targetFolderId) {
  const list = state.conversations;
  const from = list.findIndex((c) => c.id === focusId);
  if (from < 0) return;
  const [item] = list.splice(from, 1);
  ensureFocusOrgFields(item, { assignFolder: false });
  if (targetFolderId !== undefined) {
    item.folderId = targetFolderId || null;
  }
  item.updatedAt = Date.now();
  if (!beforeId) {
    list.push(item);
  } else {
    let to = list.findIndex((c) => c.id === beforeId);
    if (to < 0) list.push(item);
    else list.splice(to, 0, item);
  }
  persist();
  renderConvoList();
}

let _dragFocusId = null;

function wireFocusDrag(row, focus) {
  row.addEventListener("dragstart", (e) => {
    _dragFocusId = focus.id;
    row.classList.add("dragging");
    try {
      e.dataTransfer.setData("text/plain", focus.id);
      e.dataTransfer.effectAllowed = "move";
    } catch {
      /* IE / restricted */
    }
  });
  row.addEventListener("dragend", () => {
    _dragFocusId = null;
    row.classList.remove("dragging");
    els.convoList?.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  });
  row.addEventListener("dragover", (e) => {
    if (!_dragFocusId || _dragFocusId === focus.id) return;
    e.preventDefault();
    row.classList.add("drag-over");
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {
      /* ignore */
    }
  });
  row.addEventListener("dragleave", () => {
    row.classList.remove("drag-over");
  });
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("drag-over");
    const id = _dragFocusId || e.dataTransfer?.getData("text/plain");
    if (!id || id === focus.id) return;
    // Place dragged item before this row; adopt this row's folder
    const targetFolder =
      focus.folderId !== undefined ? focus.folderId : null;
    reorderFocuses(id, focus.id, targetFolder);
  });
}



/** One-click export of Focus intelligence dossier as markdown download. */
function exportFocusDossier(focusId) {
  const focus = state.conversations.find((c) => c.id === focusId);
  if (!focus) return;
  try {
    const md = buildFocusMarkdown(focus, state.spells || []);
    const name = focusFileName(focus) || `${focus.id}.md`;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Dossier exported: ${name}`, "success");
  } catch (err) {
    console.warn("exportFocusDossier failed", err);
    toast("Export failed", "error");
  }
}

function onFocusSearchInput() {
  state.focusSearchQuery = els.focusSearch?.value || "";
  renderConvoList();
}

/**
 * Permanent Focus delete — spells, chat, intelligence file, localStorage.
 * No undo.
 */
async function requestDeleteFocus(focusId) {
  const focus = state.conversations.find((c) => c.id === focusId);
  if (!focus) return;

  if (isCell2CoreFocus(focus) || focus.system) {
    toast("Cell2 Core is system intelligence substrate — cannot purge", "");
    return;
  }

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

  // Active focus fallback (skip system/hidden Cell2)
  if (state.activeId === focusId) {
    state.activeId =
      state.conversations.find((c) => isVisibleFocus(c))?.id || null;
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
    if (Array.isArray(data.focusFolders)) {
      // keep folders; no per-focus folder cleanup needed beyond conversations
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
    els.entityIcon.textContent = "—";
    els.entityName.textContent = "—";
    els.entityType.textContent = "—";
    if (els.sealedChannelValue) els.sealedChannelValue.textContent = "—";
    if (els.universeStage) els.universeStage.textContent = "VOID";
    if (els.spellCount) els.spellCount.textContent = "";
    if (els.spellCount) els.spellCount.dataset.count = "0";
    setChatControlsEnabled(false);
    if (els.chatInput) els.chatInput.placeholder = "Select a focus to begin casting spells.";
    if (els.constellationPing) els.constellationPing.textContent = "Select a focus";
    if (els.universeHudStage) els.universeHudStage.textContent = "VOID · 0% · —";
    const empty =
      els.emptyState ||
      (() => {
        const d = document.createElement("div");
        d.className = "empty-state";
        d.id = "empty-state";
        d.innerHTML = `
          <div class="empty-glyph">—</div>
          <p>Select a focus to begin casting spells.</p>
          <p class="empty-hint">No spells. No history. No connection.</p>
        `;
        els.emptyState = d;
        return d;
      })();
    els.chatMessages.appendChild(empty);
    return;
  }

  /* archetype removed */
  els.entityIcon.textContent = "✧";
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
    els.chatInput.placeholder = `Speak about ${convo.name} — /bus list · Cast Spell for Alignment Reveal…`;
  } else if (isAiNode(convo)) {
    els.chatInput.placeholder = `Speak about ${convo.name} — /bus <node> <msg> · Cast Spell…`;
  } else {
    els.chatInput.placeholder = `Speak about ${convo.name}… · /bus list · talk to <node>`;
  }

  if (!convo.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <div class="empty-glyph">✧</div>
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

/** Safe target name chip for spell cards (spell.target = Focus / node name). */
function spellTargetBadge(spell) {
  if (!spell || !spell.target) return "";
  return escapeHtml(String(spell.target));
}

/**
 * Linked-node chips under expanded spell body.
 * Stub: node-link UI is optional; never block render if empty.
 */
function scrollListNodeBadgesForSpell(spell, convo) {
  if (!spell) return "";
  const chips = [];
  const target = String(spell.engageNodeName || spell.target || "").trim();
  if (target) {
    const ch = spell.engageNodeChannel ? ` · ${spell.engageNodeChannel}` : "";
    chips.push(
      `<span class="spell-node-badge" title="Target node">${escapeHtml(target + ch)}</span>`
    );
  }
  if (isNodeEngageSpell(spell)) {
    chips.push(
      `<span class="spell-node-badge spell-node-engage" title="Proactive ENGAGE packet · SCROLL LIST embedded">ENGAGE</span>`
    );
  }
  if (convo && isNodeEngageSpell(spell)) {
    chips.push(
      `<span class="spell-node-badge" title="SCROLL LIST in payload">SCROLL LIST</span>`
    );
  }
  return chips.join("");
}

function renderSpells() {
  try {
    const convo = activeConvo();
    // Self-heal FIRST so badge + Active list share one post-heal truth
    if (convo) stripReceiptSpells(convo.id);
    if (healSpellLifecycles()) persist();

    const view = ensureSpellView();
    const readyList = convo ? activeSpellsFor(convo.id) : [];
    const histList = convo ? historySpellsFor(convo.id) : [];
    const list = view === "history" ? histList : readyList;

    // Badge = Active queue length only (0 when list empty — no ghost 5)
    syncSpellCountBadges(convo?.id || null, readyList.length);

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
          ? "Tap a card to copy · sealed history. Double-tap ✕ only to prune sludge."
          : "Tap a spell card to copy (seals the cast). Paste the reply into chat to densen, then Cast Spell for the next true priority.";
    }

    if (!convo) {
      els.spellsList.innerHTML = `<div class="spells-empty">Select a focus to see its spells.</div>`;
      syncSpellCountBadges(null, 0);
      return;
    }

    if (!list.length) {
      els.spellsList.innerHTML = `<div class="spells-empty">${
        view === "history"
          ? "No cast history yet.<br/>Tap a READY spell card to copy — it drops here with timestamps."
          : isAiNode(convo) && !convoAlignmentUnlocked(convo)
            ? "Cast Spell for <strong>Alignment Reveal</strong>, or state intent in chat."
            : isAiNode(convo)
              ? "State intent in chat or hit <strong>Cast Spell</strong> to forge a directive."
              : "Talk to Grimoire — clear intent auto-casts a spell."
      }</div>`;
      // Empty Active ⇒ badges must be 0 (fixes ghost sidebar 5)
      if (view === "active") syncSpellCountBadges(convo.id, 0);
      return;
    }

    els.spellsList.innerHTML = "";
    if (view === "history") {
      list.forEach((spell) => {
        const item = document.createElement("article");
        const showSelf = false;
        item.className =
          "spell-item spell-history spell-tap-copy";
        item.dataset.spellId = spell.id;
        if (showSelf) item.dataset.selfCast = "1";
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.title = "Tap to copy spell";
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
        "spell-item spell-tap-copy" +
        (isSent ? " spell-history" : "") +
        (mode === "primary" ? " spell-primary" : " spell-hold") +
        (showSelf ? " spell-self-castable" : "");
      item.dataset.spellId = spell.id;
      if (showSelf) item.dataset.selfCast = "1";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.title = "Tap to expand / Update Spell";
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
      const targetBadge = spellTargetBadge(spell, convo);
      const scrollNodeBadges = isSent ? "" : scrollListNodeBadgesForSpell(spell, convo);
      item.innerHTML = `
        <button type="button" class="delete-btn" data-action="delete" title="${isSent ? "Prune from history (two-tap)" : "Delete spell"}">✕</button>
        ${spellCardTopHtml(spell, convo, { badgeClass, badgeText })}
        <div class="spell-collapsed-meta">
          ${targetBadge ? `<span class="spell-target-badge">${targetBadge}</span>` : ""}
          ${escapeHtml(spell.purpose || "<i>untitled</i>")}
        </div>
        <div class="spell-expanded-body" hidden>
          <pre class="spell-full">${escapeHtml(md)}</pre>
          <div class="spell-node-links">${scrollNodeBadges || '<span class="spell-node-empty">No linked nodes</span>'}</div>
          <div class="spell-expanded-actions">
            <button type="button" class="btn-spell edit" data-action="edit" title="Edit spell">Edit</button>
            <button type="button" class="btn-spell delete" data-action="delete" title="Delete spell">Delete</button>
            <button type="button" class="btn-spell update" data-action="update" title="Update Spell — copies text, collapses">Update Spell</button>
          </div>
        </div>
        ${timeLine}
      `;
      wireSpellCardActions(item, spell, { sealOnCopy: !isSent, convo });
      els.spellsList.appendChild(item);
    }

    if (primary) {
      try {
        appendSpellCard(primary, "primary");
      } catch (err) {
        console.warn("spell card render failed", primary?.id, err);
      }
    }
    rest.forEach((spell) => {
      try {
        appendSpellCard(spell, "hold");
      } catch (err) {
        console.warn("spell card render failed", spell?.id, err);
      }
    });

    // Never use painted DOM length here — History view paints sealed cards;
    // button badge must stay Active-ready only (set in finally via syncFocusBadges).
  } finally {
    // Sovereign badge lock: top-right + sidebar = activeReadyCount only (not total)
    syncFocusBadges();
    // General derivedNodes auto-population + SCROLL LIST vault write
    const convo = activeConvo();
    if (convo) {
      const before = (convo.derivedNodes || []).length;
      populateDerivedNodesFromSpells(convo);
      if ((convo.derivedNodes || []).length !== before) {
        convo.updatedAt = Date.now();
        persist();
      }
      void writeScrollListToVault(convo);
    }
  }
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
  if (isNodeEngageSpell(spell)) return true;
  if (isCuriositySpell(spell)) return true;
  if (spell.autoGenerated && (spell.curiosityMode === "self" || spell.curiosityMode === "user")) {
    return true;
  }
  const body = [spell.purpose, spell.essence, spell.crafted, spell.message]
    .filter(Boolean)
    .join("\n");
  if (/CURIOSITY\s*[·.]|ENGAGE\s*[·.]/i.test(String(spell.purpose || ""))) return true;
  if (
    /LINKED NODE|NUCLEUS FOCUS|ecosystem links|ecosystem probe|ecosystem brief|PROACTIVE NODE ENGAGEMENT/i.test(body) &&
    /tie-?back|orbit|nucleus|linked|engage/i.test(body)
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
      `<span class="status-badge status-bridge" title="AI node bridge — linked intelligence ties back to this Focus as nucleus">BRIDGE</span>`
    );
  }
  chips.push(`<span class="${escapeHtml(badgeClass)}">${badgeText}</span>`);
  return `<div class="spell-item-badges">${chips.join("")}</div>`;
}

/**
 * Card header: title clamps cleanly; badges never leave the card.
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
 * Action row — card itself is tap-to-copy (no separate Copy button).
 * Optional SELF-CAST + View only.
 */
function spellActionsHtml(spell, convo, { isSent }) {
  const self = shouldShowSelfCastButton(spell, convo);
  const selfBtn = self
    ? `<button type="button" class="btn-spell self-cast" data-action="self-cast" title="Enter this spell into the current Focus chat automatically — no copy/paste" aria-label="SELF-CAST into Focus chat">SELF-CAST</button>`
    : "";
  return `<div class="spell-actions${self ? " has-self-cast" : ""}">${selfBtn}<button type="button" class="btn-spell expand" data-action="expand">View</button><span class="spell-tap-hint" aria-hidden="true">tap card to copy</span></div>`;
}

function wireSpellCardActions(item, spell, { sealOnCopy, convo }) {
  const deleteBtn = item.querySelector('[data-action="delete"]');
  const updateBtn = item.querySelector('[data-action="update"]');
  const expandBtn = item.querySelector('[data-action="expand"]');
  const editBtn = item.querySelector('[data-action="edit"]');
  deleteBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    requestDeleteSpell(spell.id, e.currentTarget);
  });
  editBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditSpellDialog(item, spell);
  });
  updateBtn?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await copySpell(spell.id, { seal: sealOnCopy });
    item.classList.remove("expanded");
    const expandedBody = item.querySelector(".spell-expanded-body");
    if (expandedBody) expandedBody.hidden = true;
    if (updateBtn) updateBtn.textContent = "Update Spell";
    toast("Spell copied. Paste into target node chat.", "success");
  });
  expandBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const expandedBody = item.querySelector(".spell-expanded-body");
    const isNowExpanded = expandedBody && !expandedBody.hidden;
    if (expandedBody) expandedBody.hidden = isNowExpanded;
    if (expandBtn) expandBtn.textContent = isNowExpanded ? "View" : "Hide";
  });
  item.querySelectorAll('[data-action="self-cast"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      selfCastSpell(spell.id);
    });
  });

  const doExpand = (event) => {
    if (event?.target?.closest?.("button, a, input, textarea, .spell-actions")) return;
    const expandedBody = item.querySelector(".spell-expanded-body");
    if (!expandedBody) return;
    const showing = !expandedBody.hidden;
    expandedBody.hidden = showing;
    if (expandBtn) expandBtn.textContent = showing ? "View" : "Hide";
  };

  item.addEventListener("click", doExpand);
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      if (e.target.closest("button")) return;
      e.preventDefault();
      void doExpand();
    }
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
 * Two-tap clear-all for current Focus only — seals/removes Active queue spells.
 * History (status sent) is kept.
 */
function requestClearAllSpells() {
  const convo = activeConvo();
  if (!convo) {
    toast("Select a focus first", "");
    return;
  }
  const key = "clear-all";
  if (pendingDeletes.has(key)) {
    clearTimeout(pendingDeletes.get(key));
    pendingDeletes.delete(key);
    els.btnClearAll?.classList.remove("confirming");

    const ready = activeSpellsFor(convo.id);
    const removeIds = new Set(ready.map((s) => s.id));
    state.spells = state.spells.filter((s) => {
      if (s.conversationId !== convo.id) return true;
      if (!removeIds.has(s.id)) return true;
      return false; // drop active queue entirely
    });
    // Strip embedded spell messages for removed ids
    convo.messages = (convo.messages || []).filter(
      (m) => !(m.role === "spell" && removeIds.has(m.spellId))
    );

    persist();
    renderAll();
    syncFocusIntelligenceFile(convo, "SPELLS_CLEARED", `Cleared ${removeIds.size} active spell(s)`);
    toast(
      removeIds.size
        ? `Cleared ${removeIds.size} active spell${removeIds.size === 1 ? "" : "s"} — history kept`
        : "No active spells to clear",
      "success"
    );
    return;
  }

  els.btnClearAll?.classList.add("confirming");
  toast("Tap Clear Active again to confirm", "");
  const t = setTimeout(() => {
    pendingDeletes.delete(key);
    els.btnClearAll?.classList.remove("confirming");
  }, DELETE_CONFIRM_MS);
  pendingDeletes.set(key, t);
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
  // Heal lifecycle BEFORE any badge math (sidebar was counting pre-heal zombies)
  if (healSpellLifecycles()) persist();

  // Keep panel class + toggle button in sync with state
  const appEl = els.app || document.querySelector(".app");
  if (appEl) appEl.classList.toggle("spells-collapsed", !state.spellsOpen);
  if (els.btnToggleSpells) {
    els.btnToggleSpells.setAttribute("aria-expanded", state.spellsOpen ? "true" : "false");
  }
  applyUniverseViewMode();
  renderConvoList();
  renderChat();
  renderSpells(); // re-syncs header + active-focus sidebar badge from Active queue
  renderLittleChat();
  renderStars();
  updateAttachButtonState();
  renderPendingImages();
  if (els.universeLegend && !els.universeLegend.hasAttribute("hidden")) {
    renderIntelAtlas(activeConvo());
  }
}

// ─── Complex spell little chat (quantum leap plans) ───

function ensureLittleChat(convo) {
  if (!convo) return null;
  if (!convo.littleChat || typeof convo.littleChat !== "object") {
    convo.littleChat = { messages: [], leaps: [], checklist: [], craftMode: false };
  }
  if (!Array.isArray(convo.littleChat.messages)) convo.littleChat.messages = [];
  if (!Array.isArray(convo.littleChat.leaps)) convo.littleChat.leaps = [];
  if (!Array.isArray(convo.littleChat.checklist)) convo.littleChat.checklist = [];
  return convo.littleChat;
}

function setSpellsTitleMenuOpen(open) {
  const menu = els.spellsTitleMenu;
  const btn = els.btnSpellsTitle;
  if (!menu || !btn) return;
  if (open) menu.removeAttribute("hidden");
  else menu.setAttribute("hidden", "");
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  btn.classList.toggle("open", Boolean(open));
}

function closeComplexCraftDialog() {
  try {
    els.complexCraftDialog?.close();
  } catch {
    els.complexCraftDialog?.removeAttribute("open");
  }
}

/**
 * Spells → Craft complex spell: modal little chat + large checklist (not a bottom dock).
 */
function openCraftComplexSpell() {
  setSpellsTitleMenuOpen(false);
  const convo = activeConvo();
  if (!convo) {
    toast("Select a Focus first", "");
    return;
  }

  // Spells panel can stay open; craft UI is the modal (no bottom cut-off)
  setSpellsOpen(true);

  const lc = ensureLittleChat(convo);
  lc.craftMode = true;

  if (!lc.checklist.length) {
    lc.checklist = defaultComplexChecklist(convo).map((text) => ({
      id: uid("chk"),
      text,
      done: false,
    }));
  }

  if (!lc.messages.length) {
    lc.messages.push({
      id: uid("lcm"),
      role: "grimoire",
      kind: "complex-checklist",
      text: `**Craft complex spell** for **${convo.name}** (nucleus).\nWork the plan checklist below — each step unlocks denser Focus intelligence. Main chat stays clean.`,
      ts: Date.now(),
    });
  }

  if (els.complexCraftSub) {
    els.complexCraftSub.textContent = `${convo.name} · ${getSealedChannel(convo)} · nucleus`;
  }

  persist();
  renderLittleChat();

  const dlg = els.complexCraftDialog;
  if (dlg) {
    try {
      if (typeof dlg.showModal === "function") dlg.showModal();
      else dlg.setAttribute("open", "");
    } catch {
      dlg.setAttribute("open", "");
    }
  }
  els.littleChatInput?.focus();
  toast("Complex spell craft open — plan checklist ready", "success");
}

function defaultComplexChecklist(convo) {
  const name = convo?.name || "Focus";
  return [
    `Name the quantum leap for ${name} (what becomes true)`,
    "List constraints / non-negotiables for this Focus",
    "Identify the first unlock that densens the nucleus",
    "Break the leap into ordered steps (3–7 moves)",
    "Mark success criteria — how we know the complex spell worked",
    "Forge path: Cast Spell against this plan when ready",
  ];
}

/** Parse user plan text into checklist steps. */
function extractChecklistSteps(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  const lines = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const steps = [];
  for (const line of lines) {
    const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    const body = (m ? m[1] : line).replace(/^#+\s*/, "").trim();
    if (body.length >= 6 && body.length <= 160) steps.push(body);
  }
  if (steps.length >= 2) return steps.slice(0, 10);
  // Sentence clauses as steps
  return t
    .split(/[.;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10 && s.length <= 140)
    .slice(0, 8);
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
      ? `Plan steps for ${convo.name} — complex spell / quantum leap…`
      : "Select a Focus for complex spell plans…";
  }
  if (send) send.disabled = !enabled;
  if (els.complexCraftSub && convo) {
    els.complexCraftSub.textContent = `${convo.name} · ${getSealedChannel(convo)} · nucleus`;
  }

  box.innerHTML = "";
  if (!convo) {
    box.innerHTML = `<div class="little-chat-empty">Select a Focus, then Spells → Craft complex spell.</div>`;
    return;
  }

  const lc = ensureLittleChat(convo);

  // Large checklist block
  if (lc.checklist.length) {
    const list = document.createElement("div");
    list.className = "complex-checklist-panel";
    list.innerHTML = `<div class="complex-checklist-head">Complex spell plan · checklist</div>`;
    const ul = document.createElement("ul");
    ul.className = "complex-checklist";
    lc.checklist.forEach((step, idx) => {
      const li = document.createElement("li");
      li.className = "complex-checklist-item" + (step.done ? " done" : "");
      const id = step.id || `chk-${idx}`;
      step.id = id;
      li.innerHTML = `
        <label class="complex-checklist-label">
          <input type="checkbox" data-check-id="${escapeAttr(id)}" ${step.done ? "checked" : ""} />
          <span class="complex-checklist-num">${idx + 1}</span>
          <span class="complex-checklist-text">${escapeHtml(step.text)}</span>
        </label>`;
      ul.appendChild(li);
    });
    list.appendChild(ul);
    const doneN = lc.checklist.filter((s) => s.done).length;
    const foot = document.createElement("div");
    foot.className = "complex-checklist-foot";
    foot.textContent = `${doneN} / ${lc.checklist.length} steps · densens ${convo.name}`;
    list.appendChild(foot);
    box.appendChild(list);

    list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        const id = cb.getAttribute("data-check-id");
        const step = lc.checklist.find((s) => s.id === id);
        if (!step) return;
        step.done = Boolean(cb.checked);
        persist();
        if (step.done) {
          densenConstellationFromIntel(convo, 1);
          universeEvent("intel", { count: 1 });
        }
        renderLittleChat();
        const snap = deriveFocusSnapshot(convo, state.spells);
        setFocusUniverse(snap, { warp: false });
        updateUniverseHudChrome(snap);
      });
    });
  }

  if (!lc.messages.length && !lc.checklist.length) {
    box.innerHTML = `<div class="little-chat-empty">Tap <strong>Spells</strong> → <strong>Craft complex spell</strong> to build a quantum leap checklist for <strong>${escapeHtml(convo.name)}</strong>.</div>`;
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
 * Local reply for complex-spell little chat — builds / refines plan checklist.
 * Never writes into the main Focus chat stream.
 */
function littleChatReply(convo, userText) {
  const name = convo.name || "Focus";
  const ch = getSealedChannel(convo);
  const t = String(userText || "").trim();
  const lower = t.toLowerCase();
  const lc = ensureLittleChat(convo);

  // Extract leap seeds + checklist steps from plan text
  const stepsFromPlan = extractChecklistSteps(t);
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
  if (lc.leaps.length > 12) lc.leaps = lc.leaps.slice(-12);

  // Merge new steps into checklist (large plan view)
  if (stepsFromPlan.length >= 2 || lc.craftMode) {
    lc.craftMode = true;
    if (stepsFromPlan.length >= 2) {
      for (const s of stepsFromPlan) {
        const key = s.toLowerCase();
        if (!lc.checklist.some((c) => String(c.text).toLowerCase() === key)) {
          lc.checklist.push({ id: uid("chk"), text: s, done: false });
        }
      }
      if (lc.checklist.length > 12) lc.checklist = lc.checklist.slice(-12);
      unlocked = true;
    } else if (!lc.checklist.length) {
      lc.checklist = defaultComplexChecklist(convo).map((text) => ({
        id: uid("chk"),
        text,
        done: false,
      }));
    }
  }

  const isLeap =
    unlocked ||
    lc.craftMode ||
    /\b(quantum|leap|unlock|complex|plan|phase|breakthrough|threshold|densify|next level|open the|checklist|steps)\b/i.test(
      lower
    ) ||
    t.length >= 40;

  if (isLeap) {
    densenConstellationFromIntel(convo, unlocked ? 2 : 1);
    universeEvent("intel", { count: unlocked ? 2 : 1 });
    syncFocusIntelligenceFile(convo, "QUANTUM_LEAP_PLAN", t.slice(0, 1200));
  }

  if (/\b(hello|hi|hey)\b/i.test(lower) && t.length < 24) {
    return `Little chat for **${name}** (${ch}). Use **Spells → Craft complex spell**, or paste a plan with steps — I'll build the **large checklist** that unlocks this nucleus.`;
  }

  if (unlocked || isLeap) {
    const stepN = lc.checklist.length;
    const doneN = lc.checklist.filter((s) => s.done).length;
    return [
      `**Complex plan densened** for **${name}** (nucleus).`,
      stepN
        ? `Checklist: **${doneN}/${stepN}** steps on the board above — tick them as you advance.`
        : `State numbered steps to expand the checklist.`,
      unlocked
        ? `Locked plan thread(s) into Focus intelligence.`
        : `Keep sharpening until the leap is falsifiable.`,
      ``,
      `When ready: **Cast Spell** on the main rail to forge the complex transmission against this plan.`,
    ].join("\n");
  }

  return `Heard on **${name}**. Little chat is for **complex spell / quantum leap plans**. Tap **Spells → Craft complex spell**, or list steps to build the checklist.`;
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
  toast("Complex plan densened · checklist updated", "success");
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
    els.universeViewFocusIcon.textContent = "☉";
  }
  // System labels (frame held, receipt densen) only when chat is hidden
  updateUniverseSystemLabels(convo);
}

function toggleUniverseView() {
  setUniverseView(!state.universeView);
}

// ─── Actions ───

function selectConvo(id) {
  // Cell2 Core is not a user-selectable Focus
  const target = state.conversations.find((c) => c.id === id);
  if (target && isCell2CoreFocus(target)) {
    toast("Cell2 Core is system substrate — open BRAIN to read its log", "");
    return;
  }
  if (state.activeId === id) {
    // Force re-render of this Focus sky even on re-tap
    const snap = deriveFocusSnapshot(activeConvo(), state.spells);
    setFocusUniverse(snap, { warp: false });
    updateUniverseHudChrome(snap);
    return;
  }
  state.activeId = id;
  const convo = activeConvo();
  if (convo) {
    ensureAlignmentDirective(convo);
    ensureFocusOrgFields(convo, { assignFolder: false });
    ensureCertainty(convo);
    convo.lastViewedAt = Date.now();
    populateDerivedNodesFromSpells(convo);
    void writeScrollListToVault(convo);
  }
  persist();
  // Warp to this Focus's universe — always paint starfield for this Focus
  const snap = deriveFocusSnapshot(convo, state.spells);
  setFocusUniverse(snap, { warp: true });
  // Auto-generate self/user curiosity spells about linked ecosystem nodes
  if (convo) autoGenerateCuriositySpells(convo, { silentToast: true });
  // Proactive ENGAGE for nodes this Focus has never engaged
  if (convo) autoGenerateNodeEngageSpells(convo, { silentToast: true });
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

function handleLookAround() {
  const convo = activeConvo();
  if (!convo) {
    addGrimoireMessage("Select a focus first.", "system");
    return;
  }

  const spells = (state.spells || []).filter((s) => s.conversationId === convo.id);
  const active = activeSpellsFor(convo.id);
  const history = historySpellsFor(convo.id);
  const channel = getSealedChannel(convo);
  const type = getFocusType(convo);
  const created = convo.createdAt ? new Date(convo.createdAt).toLocaleString() : "unknown";
  const recent = (convo.messages || [])
    .slice(-4)
    .map((m) => `• ${m.role === "grimoire" ? "GRIMOIRE" : m.role.toUpperCase()}: ${String(m.text || "").slice(0, 140)}`)
    .join("\n") || "• no recent messages";

  const summary = [
    `### Look around — ${convo.name} · ${channel}`,
    `Type: ${type}${convo.model && convo.model !== "Open" ? ` · ${convo.model}` : ""}`,
    `Born: ${created}`,
    ``,
    `**Recent intelligence**`,
    recent,
    ``,
    `**Spells**`,
    `Active: ${active.length} · History: ${history.length}`,
    active.length ? active.map((s) => `• ${s.purpose}`).join("\n") : "• no active spells",
    ``,
    `**What I know**`,
    `This Focus has ${(convo.messages || []).length} messages and ${spells.length} recorded spells.`,
    channel === "Local" && convo.id === "grimoire-self"
      ? "This is GRIMOIRE observing itself. Use Cast Spell to forge a self-evolution directive."
      : "Use Cast Spell to forge the next true priority from this frame.",
  ]
    .filter(Boolean)
    .join("\n");

  addGrimoireMessage(summary, "intel");
}

function addGrimoireMessage(text, kind = "system") {
  const convo = activeConvo();
  if (!convo) return;
  convo.messages = convo.messages || [];
  convo.messages.push({
    id: uid("msg"),
    role: "grimoire",
    text,
    kind,
    ts: Date.now(),
  });
  persist();
  renderChat();
  renderIntelAtlas(convo);
}

/**
 * Cell2 Message Bus — local-only routing against SCROLL-LIST.md.
 * No external network unless op === search (even then: vault-local first).
 */
function setBusStatus(label) {
  if (els.busStatusValue) els.busStatusValue.textContent = label || "idle";
  if (els.busStatus) {
    els.busStatus.title = `Cell2 Message Bus · ${label || "idle"}`;
    els.busStatus.dataset.state = label || "idle";
  }
}

function findFocusForBusNode(node) {
  if (!node) return null;
  if (node.focusId) {
    const byId = state.conversations.find((c) => c.id === node.focusId);
    if (byId) return byId;
  }
  const name = String(node.name || "").toLowerCase();
  return (
    state.conversations.find(
      (c) =>
        isVisibleFocus(c) &&
        String(c.name || "").toLowerCase() === name &&
        (!node.poe ||
          getSealedChannel(c).toLowerCase() === String(node.poe).toLowerCase())
    ) ||
    state.conversations.find(
      (c) => isVisibleFocus(c) && String(c.name || "").toLowerCase() === name
    ) ||
    null
  );
}

async function handleBusCommand(convo, cmd, rawText) {
  if (!convo || !cmd) return;

  // User bubble always recorded on current focus
  convo.messages = convo.messages || [];
  convo.messages.push({
    id: uid("msg"),
    role: "user",
    text: rawText,
    ts: Date.now(),
    kind: "bus",
  });
  touchFocus(convo);

  setBusStatus(cmd.op || "route");

  try {
    if (cmd.op === "list") {
      const { nodes, method } = await readScrollListNodes(state.conversations);
      await updateScrollListIndex(state.conversations, state.spells);
      const lines = [
        `**Cell2 Message Bus · SCROLL LIST** (${nodes.length} node(s) · ${method})`,
        ``,
        ...nodes.map(
          (n, i) =>
            `${i + 1}. **${n.name}** · \`${n.poe || "Open"}\` · ${n.certainty || "unknown"}\n   ${n.purpose || "—"}\n   \`${n.intel_file_path || "—"}\``
        ),
        ``,
        `_Local-only registry. Route: \`/bus <name> <message>\` · Search vault: \`/bus search <q>\`_`,
      ];
      if (!nodes.length) {
        lines.splice(
          2,
          0,
          "_No nodes yet. Seal AI focuses or \`/bus NewNode hello\` to register._"
        );
      }
      pushBusActivity({
        kind: "list",
        summary: `Listed ${nodes.length} SCROLL node(s)`,
        localOnly: true,
      });
      addBusReply(convo, lines.join("\n"));
      setBusStatus("idle");
      return;
    }

    if (cmd.op === "search") {
      // Opt-in search — still local vault by default (no external network)
      const q = cmd.query || "";
      if (!q) {
        addBusReply(
          convo,
          "**Bus search** needs a query.\nUsage: `/bus search <terms>` — searches SCROLL + vault intel only (no external API)."
        );
        setBusStatus("idle");
        return;
      }
      const { hits } = await searchBusLocal(q, state.conversations);
      const lines = [
        `**Cell2 Bus · local vault search** for “${q}”`,
        `_No external network call. Opt-in search stays inside GRIMOIRE-FocusIntelligence._`,
        ``,
        hits.length
          ? hits
              .slice(0, 24)
              .map(
                (h, i) =>
                  `${i + 1}. **${h.name}** · ${h.poe || "—"} · ${h.match || "hit"}\n   ${(h.purpose || "").slice(0, 160)}`
              )
              .join("\n")
          : "_No local hits._",
      ];
      addBusReply(convo, lines.join("\n"));
      setBusStatus("idle");
      return;
    }

    if (cmd.op === "ask_cell2") {
      const q = cmd.query || rawText;
      const { hits } = await searchBusLocal(q, state.conversations);
      const cell2 = ensureCell2CoreFocus(state);
      const answer = [
        `**Cell2** (local vault only)`,
        ``,
        hits.length
          ? hits
              .slice(0, 12)
              .map(
                (h) =>
                  `• **${h.name}** · ${h.poe || "Open"} — ${(h.purpose || "").slice(0, 140)}`
              )
              .join("\n")
          : "_No matching vault intelligence. Densen more via chat/Cast Spell, or `/bus list`._",
        ``,
        `_External web search is not used. Explicit opt-in only via \`/bus search\` (still vault-local)._`,
      ].join("\n");
      await densenBusMessage(cell2, q, {
        kind: "ask_cell2",
        from: "user",
        channel: "Neural",
        source: "user",
        category: "node_intel",
      });
      pushBusActivity({
        kind: "ask_cell2",
        summary: `ask cell2: ${q.slice(0, 100)}`,
        localOnly: true,
      });
      addBusReply(convo, answer);
      setBusStatus("idle");
      return;
    }

    if (cmd.op === "route") {
      await handleBusRoute(convo, cmd);
      setBusStatus("idle");
      return;
    }

    addBusReply(convo, "Unknown bus command. Try `/bus list` or `/bus <node> <message>`.");
  } catch (err) {
    console.error("[bus]", err);
    addBusReply(
      convo,
      `**Bus error:** ${err?.message || err}\nVault may be unlinked — click 📁 to attach GRIMOIRE-FocusIntelligence/.`
    );
  }
  setBusStatus("idle");
  persist();
  renderChat();
  renderConvoList();
}

function addBusReply(convo, text) {
  if (!convo) return;
  convo.messages = convo.messages || [];
  convo.messages.push({
    id: uid("msg"),
    role: "grimoire",
    text,
    ts: Date.now(),
    kind: "bus",
  });
  touchFocus(convo);
  persist();
  renderChat();
  renderConvoList();
  if (els.brainOverlay && !els.brainOverlay.hasAttribute("hidden")) {
    renderBrainLog();
  }
}

async function handleBusRoute(convo, cmd) {
  const { nodes } = await readScrollListNodes(state.conversations);
  // Prefer multi-word resolution when rest provided
  let node = null;
  let message = cmd.message || "";
  if (cmd.nodeNameRest) {
    node = resolveScrollNode(cmd.nodeName, nodes, {
      nodeNameRest: cmd.nodeNameRest,
    });
    if (node?._resolvedMessage != null) {
      message = node._resolvedMessage || message;
    }
  }
  if (!node) {
    node = resolveScrollNode(cmd.nodeName, nodes, {
      nodeNameRest: cmd.nodeNameRest,
    });
  }

  // Also try matching live focuses when SCROLL empty/miss
  if (!node) {
    const q = String(cmd.nodeName || "").toLowerCase();
    const focusHit = state.conversations.find(
      (c) =>
        isVisibleFocus(c) &&
        (String(c.name || "").toLowerCase() === q ||
          String(c.name || "").toLowerCase().includes(q))
    );
    if (focusHit) {
      node = {
        name: focusHit.name,
        poe: getSealedChannel(focusHit),
        purpose: "",
        certainty: ensureCertainty(focusHit),
        intel_file_path: entityIntelPath(entityIdFromFocus(focusHit)),
        entity_id: entityIdFromFocus(focusHit),
        focusId: focusHit.id,
        type: getFocusType(focusHit),
      };
    }
  }

  if (!node) {
    // Not found — register new bus node (ask POE lightly, default Open)
    const name = String(cmd.nodeName || "").trim();
    pushBusActivity({
      kind: "miss",
      summary: `Unknown node “${name}” — registering on SCROLL LIST`,
      nodeName: name,
      localOnly: true,
    });
    const reg = await registerBusNode(
      {
        name,
        poe: "Open",
        purpose: message
          ? `Registered via bus: ${message.slice(0, 120)}`
          : `Bus node registered by operator`,
        type: "ai",
      },
      state.conversations
    );
    // Create a real Focus so routing has a home
    let focus = createConversation({
      name,
      type: "ai",
      model: "none",
    });
    if (!focus) {
      focus = state.conversations.find(
        (c) => String(c.name || "").toLowerCase() === name.toLowerCase()
      );
    }
    if (focus && message) {
      await densenBusMessage(focus, message, {
        kind: "route",
        channel: getSealedChannel(focus),
        from: "user",
      });
    }
    await updateScrollListIndex(state.conversations, state.spells);
    addBusReply(
      convo,
      [
        `**Bus · node not on SCROLL LIST** — registered **${name}**.`,
        `POE defaulted to **Open** (edit Focus to seal Hermes/Grok/etc.).`,
        `Entity folder: \`${reg?.node?.intel_file_path || entityIntelPath(name)}\``,
        message
          ? `Message densened to the new node vault.`
          : `Send a message: \`/bus ${name} <your message>\``,
        ``,
        `_Local-only. No external lookup._`,
      ].join("\n")
    );
    if (focus) {
      state.activeId = focus.id;
      persist();
      renderAll();
    }
    return;
  }

  const target = findFocusForBusNode(node);
  const channel = node.poe || (target ? getSealedChannel(target) : "Open");
  const payload =
    message ||
    `(bus ping from **${convo.name}** — no body; operator opened channel)`;

  // Densen into target vault
  await densenBusMessage(target || node, payload, {
    kind: "route",
    channel,
    from: convo.name || "user",
    source: "user",
  });

  // Cross-focus: densen target intel into current session when routing away
  let relayNote = "";
  if (target && target.id !== convo.id) {
    const relay = await relayIntelBetweenFocuses(target, convo, payload);
    if (relay?.text) relayNote = `\n\n---\n${relay.text}`;
  }

  // Switch active focus to target when it exists
  if (target) {
    state.activeId = target.id;
    target.messages = target.messages || [];
    target.messages.push({
      id: uid("msg"),
      role: "user",
      text: payload,
      ts: Date.now(),
      kind: "bus-route",
    });
    target.messages.push({
      id: uid("msg"),
      role: "grimoire",
      text: [
        `**Cell2 Message Bus** delivered to **${target.name}** · \`${channel}\`.`,
        `Intelligence densened → \`${node.intel_file_path || entityIntelPath(entityIdFromFocus(target))}\`.`,
        `Craft a spell for this channel or keep talking — local vault only.`,
      ].join("\n"),
      ts: Date.now(),
      kind: "bus",
    });
    touchFocus(target);
  }

  await updateScrollListIndex(state.conversations, state.spells);

  addBusReply(
    convo,
    [
      `**Bus route** → **${node.name}** · \`${channel}\``,
      payload ? `> ${payload.slice(0, 400)}` : "",
      target
        ? `Switched active Focus to **${target.name}**. Message densened to vault.`
        : `Node is on SCROLL LIST but has no live Focus yet — vault entry densened at \`${node.intel_file_path}\`.`,
      relayNote,
    ]
      .filter(Boolean)
      .join("\n")
  );

  persist();
  renderAll();
}

/**
 * When user mentions another Focus by name, auto-relay that node's intel (local).
 */
async function maybeBusAutoRelay(convo, userText) {
  if (!convo || !userText || userText.length < 4) return null;
  const { nodes } = await readScrollListNodes(state.conversations);
  const lower = userText.toLowerCase();
  const hits = [];
  for (const n of nodes) {
    const nm = String(n.name || "").trim();
    if (!nm || nm.toLowerCase() === String(convo.name || "").toLowerCase())
      continue;
    if (nm.length < 3) continue;
    if (lower.includes(nm.toLowerCase())) {
      const focus = findFocusForBusNode(n);
      if (focus && focus.id !== convo.id) hits.push(focus);
    }
  }
  if (!hits.length) return null;
  const parts = [];
  for (const f of hits.slice(0, 3)) {
    const r = await relayIntelBetweenFocuses(f, convo, userText.slice(0, 120));
    if (r?.text) parts.push(r.text);
  }
  if (!parts.length) return null;
  return {
    reply: [
      `**Cell2 bus relay** (local vault — other Focuses mentioned):`,
      ``,
      ...parts,
    ].join("\n"),
  };
}

function sendMessage(text) {
  const convo = activeConvo();
  if (!convo || (!text || !text.trim())) return;

  const userText = (text || "").trim();

  // === Cell2 Message Bus — local routing (before pulse / normal chat) ===
  const busCmd = parseBusCommand(userText);
  if (busCmd) {
    handleBusCommand(convo, busCmd, userText);
    return;
  }

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

    // Inbound receipts densen entity intelligence + Cell2 substrate
    feedCell2FromInteraction(userText, {
      focus: convo,
      source: "reality",
      preface: `Inbound densen on **${convo.name}**`,
      category: classifyIntelCategory(userText),
      certainty: "inferred",
    });

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
  touchFocus(convo);

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
  // Proactive ENGAGE packets for unengaged nodes (WYFWYG — sits in spell book)
  autoGenerateNodeEngageSpells(convo, { silentToast: true });

  // Persist images under entity images/ + index into intelligence.md
  if (sentImages.length) {
    for (const url of sentImages) {
      saveEntityImage(convo, url, {
        caption: userText.slice(0, 300),
        source: "user",
        certainty: "confirmed",
      }).catch((err) => console.warn("saveEntityImage", err));
    }
  }

  // Every interaction densens entity intelligence.md + Cell2 substrate
  feedCell2FromInteraction(userText, {
    focus: convo,
    source: "user",
    preface: `Interaction on Focus **${convo.name}** (${getFocusType(convo)} · ${getSealedChannel(convo)})`,
    certainty: ensureCertainty(convo),
  });

  // Cross-Focus bus relay when other SCROLL nodes are named in chat
  maybeBusAutoRelay(convo, userText)
    .then((relay) => {
      if (!relay?.reply) return;
      convo.messages.push({
        id: uid("msg"),
        role: "grimoire",
        text: relay.reply,
        ts: Date.now(),
        kind: "bus-relay",
      });
      persist();
      renderChat();
    })
    .catch((err) => console.warn("[bus] auto-relay", err));

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
  if (isCell2CoreFocus(convo)) {
    return { alignmentJustLocked: false, cell2: true };
  }
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

/** Resolve New Focus dialog nodes live (never trust a stale els cache). */
function getNewFocusDialogEls() {
  const dialog =
    document.getElementById("new-convo-dialog") || els.dialog || null;
  const newName =
    document.getElementById("new-entity-name") || els.newName || null;
  const newType =
    document.getElementById("new-entity-type") || els.newType || null;
  const newModel =
    document.getElementById("new-entity-model") || els.newModel || null;
  const newModelLabel =
    document.getElementById("new-model-label") || els.newModelLabel || null;
  const newFocusHint =
    document.getElementById("new-focus-hint") || els.newFocusHint || null;
  // Keep els in sync for other callers
  if (dialog) els.dialog = dialog;
  if (newName) els.newName = newName;
  if (newType) els.newType = newType;
  if (newModel) els.newModel = newModel;
  if (newModelLabel) els.newModelLabel = newModelLabel;
  if (newFocusHint) els.newFocusHint = newFocusHint;
  return { dialog, newName, newType, newModel, newModelLabel, newFocusHint };
}

/** True when New Focus overlay is showing */
function isNewFocusOpen() {
  const dialog =
    document.getElementById("new-convo-dialog") || els.dialog || null;
  if (!dialog) return false;
  if (dialog.classList.contains("is-open")) return true;
  if (!dialog.hasAttribute("hidden")) return true;
  // legacy <dialog> support if old HTML still cached
  if (dialog.open) return true;
  return false;
}

/**
 * Hard-close New Focus overlay. Cancel / Escape / backdrop / post-create.
 * No native <dialog>.close() — pure hide so Cancel can never stick open.
 */
function closeNewFocusModal(e) {
  if (e) {
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch {
      /* ignore */
    }
  }
  const dialog =
    document.getElementById("new-convo-dialog") || els.dialog || null;
  const form =
    document.getElementById("new-convo-form") || els.newForm || null;
  if (!dialog) return false;

  // Legacy native dialog API if present
  try {
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
  } catch {
    /* ignore */
  }
  try {
    dialog.removeAttribute("open");
  } catch {
    /* ignore */
  }

  dialog.classList.remove("is-open");
  dialog.setAttribute("hidden", "");
  dialog.setAttribute("aria-hidden", "true");

  try {
    dialog.style.cssText = "";
    dialog.style.setProperty("display", "none", "important");
    dialog.style.setProperty("visibility", "hidden", "important");
    dialog.style.setProperty("pointer-events", "none", "important");
  } catch {
    try {
      dialog.style.display = "none";
    } catch {
      /* ignore */
    }
  }

  try {
    form?.reset?.();
  } catch {
    /* ignore */
  }

  // Restore model label default (hidden for person)
  try {
    const modelLabel = document.getElementById("new-model-label");
    if (modelLabel) modelLabel.setAttribute("hidden", "");
  } catch {
    /* ignore */
  }
  return true;
}
window.__closeNewFocusModal = closeNewFocusModal;
window.__grimoireCloseNewFocus = closeNewFocusModal;

/**
 * Open New Focus overlay — plain show/hide, no showModal.
 */
function openNewFocusModal({ name, type, model } = {}) {
  const {
    dialog,
    newName,
    newType,
    newModel,
    newModelLabel,
    newFocusHint,
  } = getNewFocusDialogEls();

  if (!dialog) {
    console.error("[NewFocus] #new-convo-dialog missing");
    try {
      toast("New Focus dialog missing — hard-refresh the page", "error");
    } catch {
      /* ignore */
    }
    return false;
  }

  try {
    if (state.universeView) setUniverseView(false, { silent: true });
  } catch {
    /* ignore */
  }

  if (newName) newName.value = name || "";
  const t = type || "person";
  if (newType) newType.value = t;
  if (newModel) {
    const m = model && model !== "Open" ? model : "none";
    newModel.value = m;
  }

  const isAi = (newType?.value || t) === "ai";
  if (newModelLabel) {
    if (isAi) newModelLabel.removeAttribute("hidden");
    else newModelLabel.setAttribute("hidden", "");
    newModelLabel.hidden = !isAi;
  }
  if (newFocusHint) {
    const hints = {
      person:
        "Person: densen who they are and craft message-spells for real life. Medium is open — Discord, text, in-person, anything.",
      place:
        "Place: anchor a location and its intelligence. Speak about this site, its history, and its secrets.",
      thing:
        "Thing: object, system, artifact, or tool. Track its behavior, upgrades, and role in your world.",
      ai: "AI: densen this node and craft curated words-as-magic. Model is optional — Hermes, Grok, Claude, Custom, or open.",
      idea: "Idea: concept, philosophy, or framework. Build it into doctrine, spawn spells, and test it against reality.",
    };
    newFocusHint.textContent = hints[newType?.value || t] || hints.person;
  }

  // Show overlay
  dialog.removeAttribute("hidden");
  dialog.classList.add("is-open");
  dialog.setAttribute("aria-hidden", "false");
  try {
    dialog.style.cssText = "";
    dialog.style.setProperty("display", "flex", "important");
    dialog.style.setProperty("visibility", "visible", "important");
    dialog.style.setProperty("opacity", "1", "important");
    dialog.style.setProperty("pointer-events", "auto", "important");
    dialog.style.setProperty("z-index", "10000", "important");
  } catch {
    dialog.style.display = "flex";
  }

  // Legacy native dialog path if someone still has old HTML
  try {
    if (typeof dialog.showModal === "function" && dialog.tagName === "DIALOG") {
      if (!dialog.open) dialog.showModal();
    }
  } catch {
    /* ignore — overlay styles already show it */
  }

  if (newName) {
    try {
      newName.focus({ preventScroll: false });
      newName.select();
    } catch {
      try {
        newName.focus();
      } catch {
        /* ignore */
      }
    }
  }
  return true;
}
window.__openNewFocusModal = openNewFocusModal;
window.__grimoireOpenNewFocus = function (e) {
  if (e && typeof e.preventDefault === "function") e.preventDefault();
  if (e && typeof e.stopPropagation === "function") e.stopPropagation();
  return openNewFocusModal({ name: "", type: "person" });
};

/** Show optional Model only for AI; person medium stays open by design. */
function syncNewFocusFormChrome() {
  const t = els.newType?.value || "person";
  const isAi = t === "ai";
  if (els.newModelLabel) els.newModelLabel.hidden = !isAi;
  if (els.newFocusHint) {
    const typeVal = els.newType?.value || "person";
    const hints = {
      person: "Person: densen who they are and craft message-spells for real life. Medium is open — Discord, text, in-person, anything.",
      place: "Place: anchor a location and its intelligence. Speak about this site, its history, and its secrets.",
      thing: "Thing: object, system, artifact, or tool. Track its behavior, upgrades, and role in your world.",
      ai: "AI: densen this node and craft curated words-as-magic. Model is optional — Hermes, Grok, Claude, Custom, or open.",
      idea: "Idea: concept, philosophy, or framework. Build it into doctrine, spawn spells, and test it against reality.",
    };
    els.newFocusHint.textContent = hints[typeVal] || hints.person;
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

// ─── Proactive node engagement (WYFWYG) ───
// 1) Node existence signal  2) Auto-forge ENGAGE spell  3) User dispatches from spell book
// 4) Node executes  5) Reply paste densens  6) SCROLL LIST + vault update

const MAX_NODE_ENGAGE_READY = 2;
const NODE_ENGAGE_PURPOSE_RE = /^ENGAGE\s*[·.]\s*/i;

function isNodeEngageSpell(spell) {
  if (!spell) return false;
  if (spell.kind === "node-engage") return true;
  if (spell.autoGenerated && spell.engageNodeId) return true;
  return NODE_ENGAGE_PURPOSE_RE.test(String(spell.purpose || ""));
}

/** Has this Focus already queued or cast an ENGAGE packet at this node? */
function hasNodeEngageHistory(convo, nodeFocusId) {
  if (!convo || !nodeFocusId) return false;
  return (state.spells || []).some(
    (s) =>
      s.conversationId === convo.id &&
      (s.engageNodeId === nodeFocusId || s.targetFocusId === nodeFocusId) &&
      isNodeEngageSpell(s)
  );
}

/**
 * Nodes that exist in the constellation but this Focus has not engaged yet.
 * Existence signal = sibling Focus present; unengaged = no ENGAGE spell history.
 */
function discoverUnengagedNodes(convo) {
  if (!convo) return [];
  const out = [];
  for (const f of state.conversations || []) {
    if (!f || f.id === convo.id) continue;
    if (hasNodeEngageHistory(convo, f.id)) continue;
    out.push({
      focusId: f.id,
      name: f.name,
      channel: getSealedChannel(f),
      type: getFocusType(f),
      summary: f.alignmentNotes
        ? String(f.alignmentNotes).replace(/\s+/g, " ").trim().slice(0, 120)
        : `${getFocusType(f)} node · ${getSealedChannel(f)}`,
    });
  }
  return out;
}

function readyNodeEngageCount(convoId) {
  return (state.spells || []).filter(
    (s) =>
      s.conversationId === convoId &&
      !spellIsSealed(s) &&
      isNodeEngageSpell(s)
  ).length;
}

/**
 * Build proactive ENGAGE spell — intelligence packet for a target node.
 * Payload includes SCROLL LIST so the node receives portable Focus context.
 */
function buildNodeEngageSpell(convo, node, medium) {
  if (!convo || !node) return null;
  const med = medium || getSealedChannel(convo) || "Open";
  const nucleus = `${convo.name} · ${getSealedChannel(convo)}`;
  const targetLabel = `${node.name} · ${node.channel}`;
  const purpose = `ENGAGE · ${node.name}`;
  const scrollBody = buildScrollList(convo, state.spells || []);

  const body = [
    `${node.name} —`,
    "",
    "TRANSMISSION TYPE: PROACTIVE NODE ENGAGEMENT",
    "AUTHORITY: Operator · Focus-as-nucleus (WYFWYG)",
    `NUCLEUS FOCUS: ${nucleus}`,
    `TARGET NODE: ${targetLabel} (${node.type})`,
    `MEDIUM: ${med}`,
    "LAW: This packet is forged because the node exists and has not been engaged from this Focus.",
    "You are not asked to abandon your world — densen only what serves the nucleus.",
    "",
    "WHY NOW:",
    `- Node existence signal: **${node.name}** is live in the constellation.`,
    `- No prior ENGAGE history from **${convo.name}** → proactive open.`,
    node.summary ? `- Known signal: ${node.summary}` : "- Thin prior intel — first contact densen.",
    "",
    "OPERATIONAL ASK:",
    "1. IDENTITY — who you are in one line relative to this nucleus",
    "2. CAPABILITY — what you can densen for the nucleus right now",
    "3. CONSTRAINT — what you will not invent or over-claim",
    "4. NEXT THREE MOVES — concrete returns the operator can paste back into Grimoire",
    "5. SIGNAL — 1–10 confidence + one-line reason",
    "",
    "─── SCROLL LIST (portable universe transfer) ───",
    scrollBody,
    "─── END SCROLL LIST ───",
    "",
    "Reply in structured form. Operator will paste your return into the nucleus Focus to update the scroll.",
    "",
    "— Operator",
  ].join("\n");

  const stableId = `${convo.id}-engage-${node.focusId}`;

  return {
    id: stableId,
    conversationId: convo.id,
    target: node.name,
    purpose,
    medium: med,
    from: "Operator",
    essence: `Proactive ENGAGE → **${targetLabel}** from nucleus **${convo.name}**`,
    crafted: `Auto-forged · node existence signal · SCROLL LIST embedded · dispatch when ready`,
    message: body,
    status: "ready",
    createdAt: Date.now(),
    kind: "node-engage",
    autoGenerated: true,
    engageNodeId: node.focusId,
    targetFocusId: node.focusId,
    engageNodeName: node.name,
    engageNodeChannel: node.channel,
    engageNodeType: node.type,
    engineeredFromAlignment: false,
  };
}

/**
 * Auto-forge proactive ENGAGE spells for unengaged nodes (cap ready queue).
 * Spells sit in the book until operator copies/dispatches — never auto-send.
 */
function autoGenerateNodeEngageSpells(convo, { silentToast = true } = {}) {
  if (!convo || selfCastInFlight) return [];
  // AI Focus: wait for alignment so packets aren't blind
  if (isAiNode(convo) && !convoAlignmentUnlocked(convo)) return [];

  const unengaged = discoverUnengagedNodes(convo);
  if (!unengaged.length) return [];

  let readySlots = MAX_NODE_ENGAGE_READY - readyNodeEngageCount(convo.id);
  if (readySlots <= 0) return [];

  const medium = syncMediumFromControls(convo);
  const forged = [];

  for (const node of unengaged) {
    if (readySlots <= 0) break;
    // Skip if ready slot already exists for this node
    const existingReady = (state.spells || []).find(
      (s) =>
        s.conversationId === convo.id &&
        !spellIsSealed(s) &&
        isNodeEngageSpell(s) &&
        s.engageNodeId === node.focusId
    );
    if (existingReady) continue;

    const spell = buildNodeEngageSpell(convo, node, medium);
    if (!spell) continue;
    commitSpell(convo, spell, { silentToast: true });
    forged.push(spell);
    readySlots -= 1;
  }

  if (forged.length && !silentToast) {
    toast(
      `ENGAGE forged: ${forged.map((s) => s.target).join(", ")} · copy when ready`,
      "success"
    );
  } else if (forged.length && silentToast) {
    activityPing?.(
      `✦ ENGAGE ready → ${forged.map((s) => s.target).slice(0, 2).join(", ")}`
    );
  }
  return forged;
}

/**
 * After node reply densens: update derivedNodes + SCROLL LIST vault.
 */
function densenScrollListFromEngage(convo, spell, replyText) {
  if (!convo || !spell) return false;
  if (!isNodeEngageSpell(spell) && !spell.engageNodeId) return false;

  if (!Array.isArray(convo.derivedNodes)) convo.derivedNodes = [];
  const name = spell.engageNodeName || spell.target || "Node";
  const channel = spell.engageNodeChannel || spell.medium || "Open";
  const key = `${String(name).toLowerCase()}::${String(channel).toLowerCase()}`;
  const snippet = String(replyText || spell.answerExcerpt || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

  const idx = convo.derivedNodes.findIndex(
    (n) =>
      `${String(n?.name || "").toLowerCase()}::${String(n?.channel || "").toLowerCase()}` ===
      key
  );
  const entry = {
    id: spell.engageNodeId || spell.targetFocusId || key,
    name,
    channel,
    type: spell.engageNodeType || "node",
    role: "engaged-densen",
    snippet: snippet || "Engagement sealed — densen captured.",
    intel: snippet,
    updatedAt: Date.now(),
    lastSpellId: spell.id,
  };
  if (idx >= 0) convo.derivedNodes[idx] = { ...convo.derivedNodes[idx], ...entry };
  else convo.derivedNodes.push(entry);

  // Cap growth
  if (convo.derivedNodes.length > 40) {
    convo.derivedNodes = convo.derivedNodes
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 40);
  }

  convo.updatedAt = Date.now();
  syncFocusIntelligenceFile(
    convo,
    "SCROLL_LIST_DENSEN",
    `ENGAGE return densened for ${name} · ${channel}: ${snippet.slice(0, 200)}`
  );
  return true;
}

/**
 * Ensure derivedNodes reflect sealed ENGAGE casts even before reply (cast step).
 */
function registerEngageOnScrollList(convo, spell) {
  if (!convo || !spell || !isNodeEngageSpell(spell)) return;
  if (!Array.isArray(convo.derivedNodes)) convo.derivedNodes = [];
  const name = spell.engageNodeName || spell.target || "Node";
  const channel = spell.engageNodeChannel || spell.medium || "Open";
  const key = `${String(name).toLowerCase()}::${String(channel).toLowerCase()}`;
  const exists = convo.derivedNodes.some(
    (n) =>
      `${String(n?.name || "").toLowerCase()}::${String(n?.channel || "").toLowerCase()}` ===
      key
  );
  if (!exists) {
    convo.derivedNodes.push({
      id: spell.engageNodeId || spell.targetFocusId || key,
      name,
      channel,
      type: spell.engageNodeType || "node",
      role: "engaged-cast",
      snippet: "Engagement cast — awaiting node reply densen.",
      updatedAt: Date.now(),
      lastSpellId: spell.id,
    });
    convo.updatedAt = Date.now();
  }
  // General spell targets/mediums also densen onto derivedNodes
  populateDerivedNodesFromSpells(convo);
}

/**
 * Auto-populate derivedNodes from all spell targets/mediums for a Focus.
 * Complements ENGAGE densen — general casts also surface on the SCROLL LIST.
 */
function populateDerivedNodesFromSpells(convo) {
  if (!convo || !Array.isArray(state.spells)) return;
  if (!Array.isArray(convo.derivedNodes)) convo.derivedNodes = [];
  // Track name::channel, name::open, and id so re-entry stays idempotent
  // (nodes store real medium as channel while insert key is always name::open).
  const seen = new Set();
  for (const n of convo.derivedNodes) {
    const nm = String(n?.name || "").toLowerCase();
    const ch = String(n?.channel || "").toLowerCase();
    if (nm) {
      seen.add(`${nm}::${ch}`);
      seen.add(`${nm}::open`);
    }
    if (n?.id) seen.add(String(n.id).toLowerCase());
  }
  for (const spell of state.spells) {
    if (spell.conversationId !== convo.id) continue;
    const name = spell.target || spell.medium;
    if (!name || String(name).toLowerCase() === String(convo.name || "").toLowerCase())
      continue;
    const key = `${String(name).toLowerCase()}::open`;
    if (seen.has(key)) continue;
    convo.derivedNodes.push({
      id: key,
      name: String(name),
      channel: spell.medium || spell.target || "Open",
      type: "node",
      role: "spell-target",
      snippet: `Spell target detected from ${spell.kind || "standard"} cast.`,
      updatedAt: Date.now(),
      lastSpellId: spell.id,
    });
    seen.add(key);
  }
  if (convo.derivedNodes.length > 40) {
    convo.derivedNodes = convo.derivedNodes
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 40);
  }
}

/**
 * Write SCROLL LIST: per-focus transfer manifest + global AI node index.
 */
async function writeScrollListToVault(convo) {
  if (!convo || isCell2CoreFocus(convo)) return { ok: false, reason: "no-convo" };
  const text = buildScrollList(
    convo,
    (state.spells || []).filter((s) => s.conversationId === convo.id)
  );
  const fileName = `SCROLL-LIST-${String(convo.name || convo.id || "UNKNOWN")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()}.md`;
  try {
    const result = await writeFocusIntelligence(convo, state.spells, {
      fileName,
      content: text,
    });
    // Global index: GRIMOIRE-FocusIntelligence/SCROLL-LIST.md
    await updateScrollListIndex(state.conversations, state.spells);
    return result;
  } catch {
    return { ok: false, reason: "write-failed" };
  }
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
  const archLabel = convo.type === "ai" ? "AI node" : convo.type === "network" ? "Network" : "Focus target";

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
      reply: `Focus is on **${convo.name}** (${archLabel} · ${medium}). Tell me what they should receive — say “draft a spell…” or hit **Cast Spell**.`,
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

  // Node-engage: stable id per target node; cap ready ENGAGE queue
  if (isNodeEngageSpell(spell)) {
    spell.kind = "node-engage";
    spell.autoGenerated = true;
    const nodeId = spell.engageNodeId || spell.targetFocusId || "node";
    const stableId = spell.id || `${convo.id}-engage-${nodeId}`;
    spell.id = stableId;
    for (const s of state.spells || []) {
      if (s.id === stableId && spellIsSealed(s)) {
        s.id = `${stableId}-hist-${s.sentAt || s.createdAt || Date.now()}`;
      }
    }
    const existingEngage = (state.spells || []).find(
      (s) =>
        s.conversationId === convo.id &&
        !spellIsSealed(s) &&
        isNodeEngageSpell(s) &&
        (s.id === stableId || s.engageNodeId === nodeId)
    );
    if (!existingEngage && readyNodeEngageCount(convo.id) >= MAX_NODE_ENGAGE_READY) {
      return;
    }
    if (existingEngage) spell.id = existingEngage.id;
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
      // Fresh active generation — do not inherit cast/answer stamps (badge leak)
      sentAt: undefined,
      copiedAt: undefined,
      answeredAt: undefined,
      selfCastAt: undefined,
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

  if (!state.spellsOpen || isSpellsVisuallyCollapsed()) {
    setSpellsOpen(true);
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
 * Persist sealed Focus intelligence to vault (entity folder append-only).
 * Always surfaces an activity ping; vault fail → amber folder dot.
 */
async function syncFocusIntelligenceFile(
  convo,
  eventType,
  eventContent,
  opts = {}
) {
  if (!convo || isCell2CoreFocus(convo)) return;
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
      result = await appendEntityIntelligence(convo, {
        body: eventContent || `Densen · ${convo.name}`,
        source: opts.source || "Cell2",
        category: opts.category || "node_intel",
        certainty: opts.certainty || ensureCertainty(convo),
      });
    }
    // Keep global AI index current
    try {
      await updateScrollListIndex(state.conversations, state.spells);
    } catch {
      /* non-fatal */
    }
    persist();

    const fileLabel =
      result?.fileName || entityIntelPath(entityIdFromFocus(convo));

    if (result?.method === "filesystem" && result?.ok !== false) {
      setVaultFailState(false);
      const starBit =
        starsAdded > 0 ? `Constellation +${starsAdded} · ` : "";
      activityPing(`✦ ${starBit}Vault written: ${fileLabel}`);
    } else if (result?.method === "memory") {
      setVaultFailState(false);
      activityPing(`✦ Intel densened (memory · link 📁 for disk: ${fileLabel})`);
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

/**
 * Route chat densen into the relevant entity's intelligence.md.
 * Also mirrors system-level truths into Cell2 Core substrate.
 */
async function feedCell2FromInteraction(userText, meta = {}) {
  const text = String(userText || "").trim();
  if (!text || text.length < 2) return null;
  if (/^\s*\.\s*$/.test(text)) return null;

  const cell2 = ensureCell2CoreFocus(state);
  const active = meta.focus || activeConvo();
  const category =
    meta.category ||
    (meta.kind && CELL2_KINDS[meta.kind]) ||
    classifyIntelCategory(text);
  const certainty = normalizeCertainty(meta.certainty || active?.certainty || "unknown");
  const body = [meta.preface || null, text.slice(0, 4000)].filter(Boolean).join("\n\n");
  const source =
    meta.source ||
    (active ? String(active.name || "user") : "user");

  let entityResult = null;
  // Write to the active Focus entity when present (node densen)
  if (active && !isCell2CoreFocus(active)) {
    entityResult = await appendEntityIntelligence(active, {
      body,
      source: source === active.name ? "user" : source,
      category,
      certainty,
      tags: meta.tags || [category, "chat"],
    });
  }

  // System substrate always receives a pointer entry
  if (cell2) {
    const sysBody = active
      ? `Via **${active.name}** · ${getSealedChannel(active)}\n\n${body}`
      : body;
    await appendCell2Intelligence(cell2, {
      body: sysBody.slice(0, 4000),
      source: "Cell2",
      category,
      certainty,
      tags: meta.tags || [category, "interaction"],
    });
    cell2.updatedAt = Date.now();
  }

  try {
    await updateScrollListIndex(state.conversations, state.spells);
  } catch {
    /* non-fatal */
  }
  persist();
  return entityResult;
}

/**
 * Cast Spell densen — append YAML intelligence entry for the Focus.
 * Runs alongside normal spell forge (does not replace spell queue).
 */
async function densenCastSpellIntelligence(convo, spell) {
  if (!convo || isCell2CoreFocus(convo)) return null;
  const body = [
    `**Cast Spell** densen for **${convo.name}** · ${getSealedChannel(convo)}`,
    spell?.purpose ? `Purpose: ${spell.purpose}` : null,
    spell?.essence ? `Essence: ${spell.essence}` : null,
    spell?.message ? `\n${String(spell.message).slice(0, 3000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const result = await appendEntityIntelligence(convo, {
    body,
    source: "user",
    category: isAlignmentSpell(spell) ? "identity" : "node_intel",
    certainty: ensureCertainty(convo),
    tags: ["cast-spell", spell?.kind || "spell"].filter(Boolean),
  });
  const cell2 = ensureCell2CoreFocus(state);
  if (cell2) {
    await appendCell2Intelligence(cell2, {
      body: `Cast on **${convo.name}**: ${spell?.purpose || "spell"}`,
      source: "Cell2",
      category: "node_intel",
      certainty: "inferred",
      tags: ["cast-spell", "index"],
    });
  }
  try {
    await updateScrollListIndex(state.conversations, state.spells);
  } catch {
    /* non-fatal */
  }
  return result;
}

/** Open BRAIN panel — read-only Cell2 Core intelligence log */
async function openBrainLog() {
  const cell2 = ensureCell2CoreFocus(state);
  if (els.brainOverlay) {
    els.brainOverlay.removeAttribute("hidden");
  }
  await renderBrainLog(cell2);
}

function closeBrainLog() {
  els.brainOverlay?.setAttribute("hidden", "");
}

async function renderBrainLog(focus) {
  const cell2 = focus || ensureCell2CoreFocus(state);
  if (!els.brainBody) return;
  els.brainBody.innerHTML = `<p class="brain-loading">Loading Cell2 intelligence…</p>`;
  try {
    const { text, method, fileName, entries } = await readCell2IntelligenceLog(cell2);
    const busLog = getBusActivityLog();
    if (els.brainSub) {
      const n = Array.isArray(entries) ? entries.length : 0;
      els.brainSub.textContent = `${fileName || CELL2_INTEL_PATH} · ${n} memory · bus ${busLog.length} · ${method}`;
    }
    els.brainBody.innerHTML = "";

    // Bus activity section (local message bus)
    const busSec = document.createElement("section");
    busSec.className = "brain-bus-section";
    const busTitle = document.createElement("h3");
    busTitle.className = "brain-bus-title";
    busTitle.textContent = "Cell2 Message Bus";
    busSec.appendChild(busTitle);
    if (!busLog.length) {
      const empty = document.createElement("p");
      empty.className = "brain-empty";
      empty.textContent =
        "No bus events yet. Try /bus list or /bus <node> <message> in chat.";
      busSec.appendChild(empty);
    } else {
      const ul = document.createElement("ul");
      ul.className = "brain-bus-log";
      for (const ev of busLog.slice().reverse().slice(0, 40)) {
        const li = document.createElement("li");
        li.className = "brain-bus-item";
        li.innerHTML = `<span class="brain-bus-kind">${escapeHtml(ev.kind)}</span> <span class="brain-bus-time">${escapeHtml(
          (ev.timestamp || "").replace("T", " ").slice(0, 19)
        )}</span><div class="brain-bus-summary">${escapeHtml(ev.summary || "")}</div>`;
        ul.appendChild(li);
      }
      busSec.appendChild(ul);
    }
    els.brainBody.appendChild(busSec);

    const pre = document.createElement("pre");
    pre.className = "brain-log";
    pre.textContent = text || "_empty_";
    els.brainBody.appendChild(pre);
    els.brainBody.scrollTop = 0;
  } catch (err) {
    els.brainBody.innerHTML = `<p class="brain-empty">Could not load Cell2 log: ${escapeHtml(String(err?.message || err))}</p>`;
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
    const cell2 = ensureCell2CoreFocus(state);
    if (cell2) await ensureCell2IntelligenceFile(cell2);
    for (const c of state.conversations) {
      if (isCell2CoreFocus(c)) continue;
      await appendEntityIntelligence(c, {
        body: `Vault linked · sealed **${c.name}** · ${getSealedChannel(c)}`,
        source: "Cell2",
        category: "identity",
        certainty: ensureCertainty(c),
        tags: ["vault-link"],
      });
    }
    await updateScrollListIndex(state.conversations, state.spells);
    // Global 📁 does not mark every focus vault-linked — each still has Create my path
    // Optionally seed active focus as linked if it didn't have a path yet
    const active = activeConvo();
    if (active && !isCell2CoreFocus(active) && !isFocusPathLinked(active)) {
      // Store global handle also under active focus for convenience
      try {
        await setFocusFolderHandle(active.id, handle, handle.name);
        markFocusVaultLinked(active.id);
      } catch {
        /* ignore */
      }
    }
    persist();
    renderConvoList();
    renderChat();
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.warn(err);
    setVaultFailState(true);
    toast("Could not open folder", "");
  }
}

/**
 * Boot vault restore only — never open showDirectoryPicker here.
 * Picker requires a user gesture (📁 icon or "Create my path").
 */
async function bootstrapIntelligenceVault() {
  if (!hasDirectoryPicker()) {
    await refreshIntelFolderUi();
    return;
  }
  try {
    // forcePrompt: false → restore from IndexedDB only; no OS picker on load
    const handle = await ensureIntelligenceFolder({ forcePrompt: false });
    await refreshIntelFolderUi();

    const cell2 = ensureCell2CoreFocus(state);
    if (cell2) await ensureCell2IntelligenceFile(cell2);

    if (handle) {
      // Previously linked vault restored — quiet seed, no toast spam
      for (const c of state.conversations) {
        if (isCell2CoreFocus(c)) continue;
        if (!Array.isArray(c.intelLog) || c.intelLog.length === 0) {
          await appendEntityIntelligence(c, {
            body: `Focus sealed: **${c.name}** · ${getSealedChannel(c)} · type ${getFocusType(c)}`,
            source: "Cell2",
            category: "identity",
            certainty: ensureCertainty(c),
            tags: ["bootstrap", "identity"],
          });
        }
      }
      await updateScrollListIndex(state.conversations, state.spells);
      // Do NOT mark all focuses vault-linked — per-focus paths only
      persist();
      renderConvoList();
    }
    // Warm per-focus handles for any focus already flagged vaultLinked
    for (const c of state.conversations || []) {
      if (c?.id && (c.vaultLinked || isFocusVaultLinked(c.id))) {
        try {
          await resolveFocusFolderHandle(c.id);
        } catch {
          /* ignore */
        }
      }
    }
    // Not linked: leave path-onboarding callouts / Create my path for user click
  } catch (err) {
    if (err?.name === "SecurityError" || /user gesture/i.test(String(err?.message || ""))) {
      console.warn("[vault] boot restore skipped picker (needs user gesture)");
    } else if (err?.name !== "AbortError") {
      console.warn(err);
    }
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
    // Still densen intelligence on attempted cast
    densenCastSpellIntelligence(convo, { purpose: "ALIGNMENT GATE", kind: "alignment" });
    persist();
    renderChat();
    renderIntelAtlas(convo);
    return;
  }

  const { spell, purged, atlas } = consolidateAndRestructureSpells(convo);

  // Curiosity densen runs with every Cast Spell (linked nodes → nucleus)
  autoGenerateCuriositySpells(convo, { silentToast: true });
  // Proactive ENGAGE for unengaged nodes
  autoGenerateNodeEngageSpells(convo, { silentToast: true });

  // Cell2 substrate: every Cast Spell appends YAML entry to entity intelligence.md
  densenCastSpellIntelligence(convo, spell && !spell.blocked ? spell : null);

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
      ? `**Intel consolidated.** Alignment Reveal ready for **${convo.name} · ${medium}**. Open Spells → **tap the card to copy** → send via ${medium} → paste full reply here to ignite the universe.${purgeNote}`
      : `**Intel consolidated · spells restructured.** Ready: **${spell.purpose}.**${craft}${dirN ? ` Locked to **${dirN}** directives.` : ""}${personHint}${purgeNote} Open Spells → **tap card to copy**. ★ HUD = Intel Atlas.`,
    ts: Date.now(),
  });

  if (!state.spellsOpen || isSpellsVisuallyCollapsed()) {
    setSpellsOpen(true);
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
  // densen general spell targets onto derivedNodes on successful copy
  const copyConvo = state.conversations.find((c) => c.id === spell.conversationId);
  if (copyConvo) populateDerivedNodesFromSpells(copyConvo);
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

  // ENGAGE cast: register on SCROLL LIST + nudge paste densen
  if (isNodeEngageSpell(spell) && !fromSelfCast) {
    const convo = state.conversations.find((c) => c.id === spell.conversationId);
    if (convo) {
      registerEngageOnScrollList(convo, spell);
      convo.messages.push({
        id: uid("msg"),
        role: "grimoire",
        text: `**ENGAGE sealed** → **${spell.target}**. Dispatch complete. When the node replies, paste the return here — I'll densen the SCROLL LIST and vault for **${convo.name}**.`,
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
      fromSelfCast
        ? "SPELL_SELF_CAST"
        : isNodeEngageSpell(spell)
          ? "NODE_ENGAGE_CAST"
          : "SPELL_SENT",
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

function createConversation({ name, type, model } = {}) {
  try {
    const cleanName = String(name || "").trim();
    if (!cleanName) {
      toast("Focus name required", "");
      return null;
    }
    // Never allow creating the system Cell2 substrate via New Focus
    if (
      cleanName.toLowerCase() === "cell2 core" ||
      cleanName.toLowerCase() === "cell2-core"
    ) {
      toast("Cell2 Core is system substrate — open BRAIN instead", "");
      return null;
    }
    let t = String(type || "person").toLowerCase().trim();
    if (!["person", "place", "thing", "ai", "idea"].includes(t)) t = "person";
    const rawModel = t === "ai" ? model || "none" : "none";
    const sealed =
      t === "ai"
        ? !rawModel || rawModel === "none"
          ? "Open"
          : rawModel
        : "Open";

    // Dedupe only against visible focuses (system/hidden never block user names)
    const visible = (state.conversations || []).filter((c) => isVisibleFocus(c));
    if (focusExists(visible, cleanName, sealed)) {
      toast(`Focus already exists: ${cleanName} · ${sealed}`);
      const existing = visible.find(
        (c) =>
          focusIdentityKey(c.name, getSealedChannel(c)) ===
          focusIdentityKey(cleanName, sealed)
      );
      if (existing) {
        state.activeId = existing.id;
        persist();
        renderAll();
      }
      return existing || null;
    }

    let id = makeFocusId(cleanName, sealed);
    if ((state.conversations || []).some((c) => c.id === id)) {
      id = `${id}-${Date.now().toString(36).slice(-4)}`;
    }

    const bornAt = Date.now();
    const messages = [];
    if (t === "ai") {
      const modelLine = sealed === "Open" ? "Open model" : sealed;
      messages.push({
        id: uid("msg"),
        role: "grimoire",
        text: `AI Focus sealed: **${cleanName}** (${modelLine}). Speak about this intelligence. Hit **Cast Spell** for Alignment Reveal — then craft words-as-magic for whatever surface you deliver on.`,
        ts: Date.now(),
        kind: "alignment-directive",
      });
    } else {
      messages.push({
        id: uid("msg"),
        role: "grimoire",
        text: `${
          t === "place"
            ? "Place"
            : t === "thing"
              ? "Thing"
              : t === "idea"
                ? "Idea"
                : "Person"
        } Focus sealed: **${cleanName}**. Speak about ${
          t === "place"
            ? "this location"
            : t === "thing"
              ? "this object/system"
              : t === "idea"
                ? "this concept"
                : "them"
        } and yourself. Cast Spell crafts communication — medium is open.`,
        ts: Date.now(),
      });
    }

    let star = { x: 40, y: 40 };
    try {
      star = randomStarPosition(state.conversations) || star;
    } catch {
      /* ignore */
    }

    const convo = {
      id,
      name: cleanName,
      type: t,
      system: false,
      hidden: false,
      certainty: "unknown",
      star,
      messages,
      createdAt: bornAt,
      updatedAt: bornAt,
      lastViewedAt: bornAt,
      pinned: false,
      tags: [],
      folderId: null,
      // Always onboard: each focus must deliberately choose its own vault path
      needsPathOnboarding: true,
      pathOnboardingDismissed: false,
      vaultLinked: false,
    };

    applyFocusClassification(convo, {
      type: t,
      model: t === "ai" ? rawModel : undefined,
    });
    // User-created focuses are never system/hidden
    convo.system = false;
    convo.hidden = false;
    delete convo.archetype;
    ensureFocusOrgFields(convo, { assignFolder: true });
    ensureCertainty(convo);
    if (convo.folderId == null) {
      try {
        convo.folderId = suggestFocusFolderId(convo);
      } catch {
        convo.folderId = null;
      }
    }

    for (const f of state.conversations || []) {
      f.messages = (f.messages || []).filter(
        (m) => m.kind !== "focus-suggestion"
      );
    }

    state.conversations = state.conversations || [];
    state.conversations.push(convo);
    state.activeId = convo.id;
    persist();
    renderAll();

    const sealLabel = getSealedChannel(convo);
    try {
      syncFocusIntelligenceFile(
        convo,
        "FOCUS_CREATED",
        `Focus sealed: ${convo.name} · ${sealLabel}`
      );
    } catch (err) {
      console.warn("[NewFocus] vault write failed (focus still created)", err);
    }
    toast(`Focus sealed: ${convo.name} · ${sealLabel}`, "success");
    return convo;
  } catch (err) {
    console.error("[NewFocus] createConversation failed", err);
    toast(`Could not create Focus: ${err?.message || err}`, "error");
    return null;
  }
}
window.__createConversation = createConversation;
window.__grimoireAppReady = true;

/** Guard against double-submit from capture + onclick + form */
let _newFocusCreating = false;

/**
 * Submit New Focus — only path for Create.
 * Reads live DOM. Closes overlay only on success.
 */
function submitNewFocusForm(e) {
  if (e) {
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch {
      /* ignore */
    }
  }
  if (_newFocusCreating) return false;
  _newFocusCreating = true;
  try {
    // Always live-query — never trust stale els
    const nameEl = document.getElementById("new-entity-name");
    const typeEl = document.getElementById("new-entity-type");
    const modelEl = document.getElementById("new-entity-model");
    const name = String(nameEl?.value || "").trim();
    if (!name) {
      toast("Focus name required", "");
      try {
        nameEl?.focus();
      } catch {
        /* ignore */
      }
      return false;
    }
    const type = String(typeEl?.value || "person").toLowerCase() || "person";
    const model =
      type === "ai" ? String(modelEl?.value || "none") || "none" : "none";

    console.log("[NewFocus] create submit", { name, type, model });
    const created = createConversation({ name, type, model });
    if (created) {
      closeNewFocusModal();
      // Force sidebar paint in case renderAll was partially swallowed
      try {
        renderConvoList();
        renderChat();
      } catch (err) {
        console.warn("[NewFocus] post-create render", err);
      }
      return true;
    }
    // Failed — leave modal open so user can fix name / retry
    console.warn("[NewFocus] create returned null — modal stays open");
    return false;
  } catch (err) {
    console.error("[NewFocus] submitNewFocusForm crashed", err);
    try {
      toast(`Create failed: ${err?.message || err}`, "error");
    } catch {
      /* ignore */
    }
    return false;
  } finally {
    setTimeout(() => {
      _newFocusCreating = false;
    }, 400);
  }
}
window.__submitNewFocusForm = submitNewFocusForm;
window.__grimoireCreateFocus = submitNewFocusForm;

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
  const trimmed = text.trim();
  if (/^look\s+around$/i.test(trimmed) || /^\/look$/i.test(trimmed)) {
    handleLookAround();
    return;
  }
  sendMessage(trimmed);
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

els.btnIntelFolder?.addEventListener("click", async () => {
  await onChooseIntelFolder();
});

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

// Spells title menu → Craft complex spell (modal — no bottom dock)
els.btnSpellsTitle?.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = els.spellsTitleMenu?.hasAttribute("hidden");
  setSpellsTitleMenuOpen(Boolean(open));
});
els.btnCraftComplexSpell?.addEventListener("click", (e) => {
  e.stopPropagation();
  openCraftComplexSpell();
});
els.btnComplexCraftClose?.addEventListener("click", () => closeComplexCraftDialog());
els.complexCraftDialog?.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeComplexCraftDialog();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest?.(".spells-title-wrap")) {
    setSpellsTitleMenuOpen(false);
  }
});

els.btnCast?.addEventListener("click", castSpell);
els.btnBrain?.addEventListener("click", () => openBrainLog());
els.btnBrainClose?.addEventListener("click", () => closeBrainLog());
els.brainOverlay?.addEventListener("click", (e) => {
  if (e.target === els.brainOverlay) closeBrainLog();
});

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

/**
 * Single source of truth for Spells panel open/collapsed.
 * Always syncs state + .spells-collapsed class (prevents reopen desync).
 */
function setSpellsOpen(open) {
  state.spellsOpen = Boolean(open);
  const appEl = els.app || document.querySelector(".app");
  if (appEl) {
    appEl.classList.toggle("spells-collapsed", !state.spellsOpen);
  }
  if (els.btnToggleSpells) {
    els.btnToggleSpells.setAttribute("aria-expanded", state.spellsOpen ? "true" : "false");
    els.btnToggleSpells.title = state.spellsOpen
      ? "Spells open — tap to switch Active / Cast History (Shift+tap to collapse)"
      : "Open Spells panel";
    els.btnToggleSpells.setAttribute(
      "aria-label",
      state.spellsOpen ? "Spells panel open" : "Open Spells panel"
    );
  }
  try {
    persist();
  } catch {
    /* ignore */
  }
  if (state.spellsOpen) {
    renderSpells();
    if (typeof renderLittleChat === "function") renderLittleChat();
  }
}

function toggleSpells() {
  setSpellsOpen(!state.spellsOpen);
}

function isSpellsVisuallyCollapsed() {
  const appEl = els.app || document.querySelector(".app");
  return Boolean(appEl?.classList.contains("spells-collapsed"));
}

els.btnToggleSpells?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  // Force reopen when collapsed (state can desync if only spellsOpen was flipped)
  if (!state.spellsOpen || isSpellsVisuallyCollapsed()) {
    setSpellsOpen(true);
    return;
  }
  // Shift+tap collapses when open
  if (e.shiftKey) {
    setSpellsOpen(false);
    return;
  }
  // Open: cycle Active ↔ Cast History
  setSpellView(ensureSpellView() === "active" ? "history" : "active");
});
els.btnCloseSpells?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  setSpellsOpen(false);
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
    if (isNewFocusOpen()) return;
    e.preventDefault();
    setUniverseView(false);
  }
});

// ─── New Focus: unbreakable wiring (HTML onclick + capture + direct + form) ───
function onNewFocusButtonClick(e) {
  if (e) {
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch {
      /* ignore */
    }
  }
  try {
    openNewFocusModal({ name: "", type: "person" });
  } catch (err) {
    console.error("[NewFocus] open threw", err);
    const d = document.getElementById("new-convo-dialog");
    if (d) {
      d.removeAttribute("hidden");
      d.setAttribute("open", "");
      d.style.display = "block";
      d.style.zIndex = "10000";
    }
  }
}

function bindNewFocusButton() {
  const btn = document.getElementById("btn-new-convo");
  if (!btn) return;
  els.btnNew = btn;
  btn.style.position = "relative";
  btn.style.zIndex = "100";
  btn.style.pointerEvents = "auto";
  btn.style.cursor = "pointer";
  btn.removeEventListener("click", onNewFocusButtonClick);
  btn.addEventListener("click", onNewFocusButtonClick);
  btn.dataset.boundNewFocus = "1";
}

function bindNewFocusForm() {
  const form = document.getElementById("new-convo-form");
  if (!form) return;
  els.newForm = form;
  form.removeEventListener("submit", submitNewFocusForm);
  form.addEventListener("submit", submitNewFocusForm);
  form.dataset.boundNewFocusForm = "1";

  const createBtn = document.getElementById("btn-create-focus");
  if (createBtn) {
    createBtn.type = "button";
    createBtn.disabled = false;
    createBtn.removeAttribute("disabled");
    createBtn.style.pointerEvents = "auto";
    createBtn.style.cursor = "pointer";
    // Primary: click
    createBtn.onclick = function (ev) {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch {
        /* ignore */
      }
      return submitNewFocusForm(ev);
    };
    // Backup: some browsers drop click under overlays — mousedown also works
    createBtn.onmousedown = function (ev) {
      if (ev.button !== 0) return;
      // Don't preventDefault on mousedown (kills focus); just schedule create
      // only if click might not fire — use a short arm
      createBtn.dataset._armed = "1";
      setTimeout(() => {
        if (createBtn.dataset._armed === "1") {
          delete createBtn.dataset._armed;
          // click usually clears this; if still armed, click was swallowed
        }
      }, 50);
    };
    createBtn.addEventListener(
      "click",
      function (ev) {
        delete createBtn.dataset._armed;
        submitNewFocusForm(ev);
      },
      { capture: true }
    );
  }

  // Enter in name field creates
  const nameEl = document.getElementById("new-entity-name");
  if (nameEl) {
    nameEl.onkeydown = function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        submitNewFocusForm(ev);
      }
    };
  }
}

function bindNewFocusAll() {
  bindNewFocusButton();
  bindNewFocusForm();
  const cancel = document.getElementById("btn-cancel-new");
  if (cancel) {
    cancel.type = "button";
    // Direct assignment + listener — both call the same hard close
    cancel.onclick = function (e) {
      closeNewFocusModal(e);
      return false;
    };
    cancel.removeEventListener("click", closeNewFocusModal);
    cancel.addEventListener("click", closeNewFocusModal);
  }
  const overlay = document.getElementById("new-convo-dialog");
  if (overlay) {
    // Click dimmed backdrop (not the panel) closes
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeNewFocusModal(e);
    });
  }
}
bindNewFocusAll();

// Capture phase: Cancel / Create / open New Focus
document.addEventListener(
  "click",
  (e) => {
    const cancelBtn = e.target?.closest?.("#btn-cancel-new");
    if (cancelBtn) {
      closeNewFocusModal(e);
      return;
    }
    const createBtn = e.target?.closest?.("#btn-create-focus");
    if (createBtn) {
      // Single create path (debounced inside submitNewFocusForm)
      submitNewFocusForm(e);
      return;
    }
    const btn = e.target?.closest?.("#btn-new-convo");
    if (!btn) return;
    if (btn.dataset._nfOpening === "1") return;
    btn.dataset._nfOpening = "1";
    setTimeout(() => {
      try {
        delete btn.dataset._nfOpening;
      } catch {
        /* ignore */
      }
    }, 300);
    onNewFocusButtonClick(e);
  },
  true
);

// Escape while New Focus is open
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (isNewFocusOpen()) closeNewFocusModal(e);
});

// Capture phase: ALWAYS handle form submit for create
document.addEventListener(
  "submit",
  (e) => {
    const form = e.target?.closest?.("#new-convo-form") || e.target;
    if (!form || form.id !== "new-convo-form") return;
    submitNewFocusForm(e);
  },
  true
);

// Re-bind after paint / boot (covers any late DOM mutations)
if (typeof requestAnimationFrame === "function") {
  requestAnimationFrame(() => bindNewFocusAll());
}
setTimeout(() => bindNewFocusAll(), 0);
setTimeout(() => bindNewFocusAll(), 500);

els.btnClearAll?.addEventListener("click", () => {
  requestClearAllSpells();
});

els.btnCancelNew?.addEventListener("click", closeNewFocusModal);

els.editDialog?.addEventListener("submit", (e) => {
  e.preventDefault();
  saveFocusEdit();
});
els.btnCancelEdit?.addEventListener("click", () => {
  els.editDialog?.close();
});

function openEditDialog() {
  const convo = activeConvo();
  if (!convo) return;
  els.editId.value = convo.id;
  els.editName.value = convo.name || "";
  els.editType.value = convo.type === "network" ? "network" : convo.type === "ai" ? "ai" : "person";
  const raw = convo.model || convo.channel || "none";
  els.editModel.value = ["Hermes","Claude","ChatGPT","Grok","Local","Custom"].includes(raw) ? raw : "none";
  els.editModelLabel.hidden = els.editType.value !== "ai";
  els.editDialog?.showModal();
}

function saveFocusEdit() {
  const convo = state.conversations.find((c) => c.id === els.editId.value);
  if (!convo) return;
  const newName = (els.editName.value || "").trim();
  if (!newName) {
    toast("Focus name required", "");
    return;
  }
  const newType = els.editType.value === "ai" ? "ai" : els.editType.value === "network" ? "network" : "person";
  const newModel = newType === "ai" ? (els.editModel.value || "none") : "none";
  const newSealed = newType === "ai"
    ? (!newModel || newModel === "none" ? "Open" : newModel)
    : "Open";

  if (
    newName.toLowerCase().trim() !== convo.name.toLowerCase().trim() ||
    newSealed.toLowerCase() !== (getSealedChannel(convo) || "Open").toLowerCase()
  ) {
    if (focusExists(state.conversations, newName, newSealed)) {
      toast(`Focus already exists: ${newName} · ${newSealed}`);
      return;
    }
  }

  convo.name = newName;
  convo.type = newType;
  convo.model = newModel;
  if (newType !== "ai") convo.model = "none";

  const id = makeFocusId(convo.name, getSealedChannel(convo));
  if (id && id !== convo.id && !state.conversations.some((c) => c.id === id)) {
    convo.id = id;
  }

  persist();
  renderAll();
  syncFocusIntelligenceFile(convo, "FOCUS_UPDATED", `Updated: ${convo.name} · ${getSealedChannel(convo)}`);
  els.editDialog?.close();
  toast(`Updated: ${convo.name} · ${getSealedChannel(convo)}`, "success");
}

els.newType?.addEventListener("change", () => {
  syncNewFocusFormChrome();
});
els.editType?.addEventListener("change", () => {
  els.editModelLabel.hidden = els.editType.value !== "ai";
});

els.btnEditFocus?.addEventListener("click", () => {
  openEditDialog?.();
});

els.btnCopyScrollList?.addEventListener("click", async () => {
  const convo = activeConvo();
  if (!convo) {
    toast("Select a focus first", "");
    return;
  }
  try {
    const text = buildScrollList(convo, state.spells);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast("SCROLL List copied — paste directly into any AI node", "success");
  } catch (err) {
    console.warn("Copy SCROLL List failed", err);
    toast("Copy failed", "");
  }
});

els.btnPurgeFocus?.addEventListener("click", () => {
  const convo = activeConvo();
  if (!convo) {
    toast("Select a focus to purge", "");
    return;
  }
  const label = `${convo.name} · ${getSealedChannel(convo)}`;
  const ok = window.confirm(
    `Execute Healer purge?\n\n${label}\n\nThis is true annihilation — no tombstone, no history, no recovery. This cannot be undone.`
  );
  if (!ok) return;
  deleteFocus(convo.id);
});

els.brandText?.addEventListener("click", () => {
  openAppSettings();
});
els.btnAppSettingsClose?.addEventListener("click", () => {
  closeAppSettings();
});
document.addEventListener("click", (e) => {
  if (
    els.appSettingsPanel &&
    !els.appSettingsPanel.hasAttribute("hidden") &&
    !e.target.closest("#app-settings-panel") &&
    !e.target.closest("#brand-text")
  ) {
    closeAppSettings();
  }
});

function openAppSettings() {
  if (!els.appSettingsPanel) return;
  els.appSettingsPanel.removeAttribute("hidden");
  toast("App settings opened", "");
}

function closeAppSettings() {
  if (!els.appSettingsPanel) return;
  els.appSettingsPanel.setAttribute("hidden", "");
}

/* ─── EVG ─── */

function openGallery() {
  const convo = activeConvo();
  if (!convo) {
    toast("Select a focus first", "");
    return;
  }
  renderGallery(convo);
  try {
    els.galleryDialog?.showModal?.();
  } catch {
    els.galleryDialog?.removeAttribute?.("hidden");
  }
}

function closeGallery() {
  try {
    els.galleryDialog?.close?.();
  } catch {
    els.galleryDialog?.setAttribute?.("hidden", "");
  }
}

function renderGallery(convo) {
  const container = els.galleryBody;
  if (!container) return;
  const items = [];
  for (const m of (convo.messages || [])) {
    for (const img of (m.images || [])) {
      items.push({
        src: img,
        text: (m.text || "").trim(),
        ts: m.ts,
        role: m.role,
      });
    }
  }
  if (!items.length) {
    container.innerHTML = `<p class="gallery-empty">No images captured for this Focus yet.</p>`;
    return;
  }
  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "gallery-grid";
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "gallery-card";
    const imgEl = document.createElement("img");
    imgEl.src = item.src;
    imgEl.alt = "Focus-captured image";
    imgEl.loading = "lazy";
    const caption = document.createElement("div");
    caption.className = "gallery-caption";
    const roleText = item.role === "user" ? "YOU" : item.role === "grimoire" ? "GRIMOIRE" : item.role || "—";
    const dateText = item.ts ? new Date(item.ts).toLocaleString() : "";
    caption.innerHTML = `
      <div class="gallery-meta">${escapeHtml(roleText)}${dateText ? ` · ${escapeHtml(dateText)}` : ""}</div>
      <div class="gallery-intel">${escapeHtml(item.text.slice(0, 240))}${item.text.length > 240 ? "…" : ""}</div>
    `;
    card.appendChild(imgEl);
    card.appendChild(caption);
    card.addEventListener("click", () => {
      openGalleryLightbox(item);
    });
    grid.appendChild(card);
  }
  container.appendChild(grid);
}

function openGalleryLightbox(item) {
  const overlay = document.createElement("div");
  overlay.className = "gallery-lightbox";
  overlay.innerHTML = `
    <button type="button" class="gallery-lightbox-close" aria-label="Close">×</button>
    <div class="gallery-lightbox-body">
      <img src="${escapeAttr(item.src)}" alt="Focus-captured image" />
      <div class="gallery-lightbox-intel">
        <div class="gallery-meta">${escapeHtml(item.role === "user" ? "YOU" : item.role === "grimoire" ? "GRIMOIRE" : (item.role || "—"))}${item.ts ? ` · ${escapeHtml(new Date(item.ts).toLocaleString())}` : ""}</div>
        <div class="gallery-intel">${escapeHtml(item.text || "")}</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".gallery-lightbox-close")) {
      overlay.remove();
    }
  });
}

els.btnSidebarToggle?.addEventListener("click", () => {
  toggleSidebar();
});

els.focusSearch?.addEventListener("input", () => {
  onFocusSearchInput();
});
els.focusSearch?.addEventListener("search", () => {
  onFocusSearchInput();
});
els.btnNewFolder?.addEventListener("click", () => {
  createFocusFolder();
});

els.btnOpenGallery?.addEventListener("click", () => {
  openGallery();
});

els.btnGalleryClose?.addEventListener("click", () => {
  closeGallery();
});

function resetApp() {
  if (!confirm("Reset Grimoire? This clears all focuses, spells, and saved state.")) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("grimoire-mvp-v1");
    localStorage.removeItem("grimoire-state-v1");
    localStorage.removeItem("grimoire-sidebar-collapsed-v1");
  } catch {}
  state.conversations = [];
  state.spells = [];
  state.activeId = null;
  state.focusFolders = structuredClone(DEFAULT_FOCUS_FOLDERS);
  state.focusSearchQuery = "";
  if (els.focusSearch) els.focusSearch.value = "";
  setSpellsOpen(true);
  persist();
  renderAll();
  toast("App reset — fresh start", "success");
}

els.btnResetApp?.addEventListener("click", resetApp);

// New Focus form also bound in bindNewFocusAll / capture submit — keep els path too
els.newForm?.addEventListener("submit", submitNewFocusForm);

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
// Promote ghost-cast spells (lifecycle stamps without status:"sent") so badges match Active
healSpellLifecycles();
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

// Sync Spells panel class + reopen button labels from saved state
setSpellsOpen(Boolean(state.spellsOpen));
applySidebarCollapsed(loadSidebarCollapsed());
applyUniverseViewMode();
// Silent merge of kind+purpose duplicates on load
state.spells = dedupeSpells(
  (state.spells || []).filter((s) => !isReceiptSpell(s))
);
// Boot: auto-generate curiosity + proactive ENGAGE for active Focus
{
  const bootFocus = activeConvo();
  if (bootFocus) {
    autoGenerateCuriositySpells(bootFocus, { silentToast: true });
    autoGenerateNodeEngageSpells(bootFocus, { silentToast: true });
  }
}
renderAll();
// Initial universe for active focus (no warp on first paint)
{
  const snap = deriveFocusSnapshot(activeConvo(), state.spells);
  setFocusUniverse(snap, { warp: false });
  updateUniverseHudChrome(snap);
}

// Self-init intelligence vault (creates GRIMOIRE-FocusIntelligence/)
/* catch-wrapper for renderAll */
(function() {
  var _orig = renderAll;
  renderAll = function() {
    try { _orig.call(this); }
    catch (err) {
      console.error('[renderAll] caught', err);
      if (window.__GrimoireErrors) window.__GrimoireErrors.push({ from: 'renderAll', message: err.message, stack: err.stack });
    }
  };
})();

bootstrapIntelligenceVault().finally(() => {
  if (activeConvo()) els.chatInput?.focus();
});

window.addEventListener('error', (ev) => { console.warn('[app-global] error', ev.message, ev.filename, ev.lineno); });
window.addEventListener('unhandledrejection', (ev) => { console.warn('[app-global] unhandledrejection', ev.reason); });
