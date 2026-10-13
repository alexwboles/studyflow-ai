# StudyFlow AI — Redesign Audit (2026-10-13)

## Competitors researched (3–5)
1. **Anki** (screenshot: apps.ankiweb.net intro page, 2025) — The category definer: deck list with **due counts** (blue=new, red=learning, green=review), big **Study Now** button, bottom answer bar: **Again / Hard / Good / Easy** with interval labels (e.g. "<10m", "1d", "3d"). Minimal, dense, keyboard-driven (1-4).
2. **Quizlet** (quizlet.com) — card flip animation, Learn/Test/Match modes, progress bar, streaks. Pattern: the *card is the stage*.
3. **RemNote / Memrise** — spaced repetition + streak heatmap; Memrise: "due today" hero with session flow.
4. **Duolingo** — streak flame, daily goal ring, lesson path. Pattern: daily ritual framing.
5. **Notion / flashcard plugins** — deck as database with mastery columns.

## Visual gaps vs competitors
- Current app: form → generates flashcards as a list; review is basic. Anki's signature is the **review room**: one card centered, "Show answer", then 4 interval buttons. We need that ritual.
- No due-count language (Anki's blue/red/green counts), no deck overview with per-deck due badges.
- No streak/daily-goal framing (Duolingo/Memrise pattern) — study apps live on daily ritual.
- Rounded corners present → square per Alex's rule.

## Functional gaps (prioritized)
1. **No true review session** — build Anki's loop: card front → Show answer → Again/Hard/Good/Easy with interval labels → next card; session progress (card N of M), keyboard 1-4/Space. HIGH.
2. **No deck dashboard** — home should be decks with due/new/mastered counts, "Study now" per deck, daily goal ring + streak. HIGH (uses existing deck storage).
3. **No spaced-repetition scheduling** — Again/Hard/Good/Easy should actually reschedule (SM-2-lite: intervals per rating). HIGH — this is what makes it Anki-grade.
4. **No session summary** — after the queue empties: reviewed count, again-rate, time, streak update. MEDIUM.
5. **Card creation UX** — keep existing generator; add manual add-card? Scope — defer if risky. LOW.

## Concept (1 paragraph)
**"The review room."** An Anki-grade study console: home is the **deck dashboard** — deck cards with due/new/mastered counts in Anki's blue/red/green language, a **due-today hero** with daily goal ring and streak flame, and per-deck Study buttons. Studying opens the **review room**: one card on a cream stage, keyboard hints (Space/1–4), "Show answer", then **Again / Hard / Good / Easy** buttons with live interval labels ("<10m", "1d", "4d", "7d") computed by a real SM-2-lite scheduler; session ends in a **summary** (cards reviewed, retention, time, streak). Forest green + warm cream (library-calm, distinct from the other four); squared corners; tabular numerals.

## Bug fixes found during audit
- TBD from app.js read.

## What to preserve (test contract)
Read test/smoke.sh before restructuring HTML — IDs + function names asserted there.
