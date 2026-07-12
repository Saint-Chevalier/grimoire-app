# Grimoire — Constellation Codex

**Local-first focus intelligence + spellcrafting for humans who route AIs.**

One focus. One sealed channel. Speak about them. Watch the universe densen. Cast a spell you actually send.

Grimoire is **not** another chatbot wrapper.

It is:

| Layer | Meaning |
|-------|---------|
| **Focus** | One AI node *or* one person *or* one network surface — sealed |
| **Intel** | What you paste and say becomes memory for *that* focus only |
| **Universe** | Visual map of densening intelligence (stages: VOID → COSMOS) |
| **Intel Atlas** | Optional inspect panel (★ HUD) — read what the codex knows |
| **Spell** | Ready-to-send message *or* real-world action directive |
| **You** | The human message bus — copy → send outside → paste reply → compound |

Open source because the **method** belongs in public. Private vaults stay private.

---

## Why it exists

Smart multi-agent work fails when:

1. Context dies every session  
2. Personas blur into one sludge thread  
3. “Remember everything” dumps become noise  

Grimoire’s hard rule:

> **1 Focus = 1 receiving entity.**

That single law makes alignment, memory, and progress *auditable*.

---

## Quick start

**This is a static ESM web app.**  
There is **no** `package.json`, **no** `npm install`, **no** `requirements.txt`, and **no** API keys.

### Prerequisites (pick one)
- **Python 3.x**, or  
- **Node.js** (only needed if you use `npx serve`)  
- Browser: Chrome / Edge recommended (optional local vault folder picker)

### Run cold (clone → serve → open)

```bash
git clone https://github.com/Saint-Chevalier/grimoire-app.git
cd grimoire-app

# Option A — Python (proven smoke path)
python -m http.server 5173

# Option B — Node (no install, no package.json)
npx --yes serve .
```

Open the printed URL (e.g. `http://localhost:5173`).

**Do not** run `npm install` or `pip install` — there are no project dependencies. Those commands **false-fail** a healthy cold run.

### Demo flow (10–15s proof)

1. Open a seeded Focus (or **New Focus**)  
2. Speak / paste intel about **that** Focus only  
3. **Cast Spell** → card lands in Spells panel  
4. **Copy** → send outside Grimoire (you are the message bus)  
5. **Mark Sent** → paste the reply back → stars densen  

Optional: click **★ HUD** for **Intel Atlas** (read-only). Close with **×**. Never auto-sends.

Optional GIF: record load → open Focus → Cast Spell.  
`docs/demo.gif` placeholder — not required for cold run.

---

## Repo map

```
index.html          shell
css/styles.css      dark constellation UI
js/app.js           core loop, cast, atlas, pulse
js/data.js          spell forge, alignment parse, seeds
js/health.js        Healer health covenant (HP per Focus)
js/universe.js      canvas cosmos engine
js/intelligence.js  optional local folder vault
js/stars.js         metrics helpers
conversations/      seed focuses (scaffold)
spells/             seed spells (scaffold)
docs/               public status + roadmap
```

Runtime state: **localStorage**. Optional disk vault folder is created only when **you** pick a parent directory in-browser.

**Secrets / OPSEC:** `.env`, vault folders, and keys are gitignored. This app does not need cloud credentials to run.

---

## Design principles (locked)

1. **Method over conscience dump** — ship engine + starter seeds, never a private kingdom library  
2. **Human-in-the-loop transport** — no silent outbound spam  
3. **Inbound ≠ forge** — receipts / ACKs / status tables must not auto-mint trash spells  
4. **Cast Spell = consolidate** — restructure ready stack against current atlas  
5. **Public / private wall** — contributors never paste private vault doctrine into PRs  

---

## Join the team

We are opening the method because **the next responsible step is people who can read this and still want to ship.**

**How to get in:**

1. Star / fork / open an issue with something real: bug, idea, or “I ran it and then…”  
2. Read `CONTRIBUTING.md`  
3. Join the Discord circle when linked in release notes (Clover Kingdom Empire)  
4. Proposals judged by **action under pressure**, not hype  

Ladder: **User → Contributor → Circle candidate → Knight / squad**

---

## What this is *not*

- Not a cloud agent that auto-messages people  
- Not a replacement for ChatGPT / Claude / Grok / Hermes themselves  
- Not the private Saint Chevalier vault  
- Not Scroll Lite (public product teacher surface rides *after* this door opens)

The private mythology (Wizard King / streets / full doctrine) is **identity**, not shipping cargo. The product here is the **codex engine**.

---

## License

MIT — see `LICENSE`.

## Status

Actively evolved. Local loop proven. Open-source path is the recruit door.

**Next up (public-safe):** [Chrono-Ring / roadmap](docs/ROADMAP.md) — read-only *when* truth densened for a Focus. Not shipped in code yet; method locked.

---

*Built for operators who treat words as causal force — and still ship code without theater.*
