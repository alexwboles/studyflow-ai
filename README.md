# 📚 StudyFlow

**AI study planner with spaced repetition — cram less, remember more.**

Students and certification-takers cram the night before and forget everything a week later. StudyFlow turns your subjects, topics, and exam date into a smart day-by-day schedule built on spaced repetition, then adapts as you rate your recall.

## The problem

- Cramming feels productive but has terrible long-term retention.
- Manual study plans are static: they never adapt when you forget something.
- Spaced-repetition apps exist, but they're flashcard-only and fiddly to set up.

## The solution

1. **Setup** — enter subjects + topics (with key points), your exam date, and daily study minutes.
2. **Smart plan** — topics are interleaved across subjects and spread over your runway; reviews auto-schedule at 1 / 3 / 7 / 14-day gaps. The last 2 days taper to reviews only — no new material right before the exam.
3. **Daily queue** — each day shows exactly what to learn and what to review.
4. **Adaptive recall** — after each review, rate yourself: *Again / Hard / Good / Easy*. Forgetting something sends it back to tomorrow; nailing it stretches the gap further.
5. **Readiness tracking** — per-subject readiness %, overall readiness, and a daily streak.

Everything runs **100% locally in your browser** (localStorage). No account, no server, no data leaving your device. An optional OpenAI key (Settings → Setup tab) powers "✨ Explain with AI" buttons on flashcards — never required.

## How the scheduling algorithm works

Inspired by **SM-2** (the classic spaced-repetition algorithm behind SuperMemo/Anki):

- Each topic has an **easiness factor (EF)**, starting at 2.5, and a current **interval** in days.
- After a review you self-rate:
  - **Again** → EF −0.2 (min 1.3), interval resets to **1 day**
  - **Hard** → EF −0.15 (min 1.3), interval × 1.2
  - **Good** → interval × EF
  - **Easy** → EF +0.1 (max 2.5), interval × EF × 1.3
- The next review date is **clamped so it never lands after the exam**.
- Initial review offsets for a newly learned topic are **1, 3, 7, 14 days**; if your exam is sooner, offsets are compressed to fit the runway.
- **Readiness** per topic = share of scheduled reviews completed (0 until the topic is first learned); subject readiness = average of its topics.

## Run it

No build step. Either:

```bash
# option 1: open directly
open index.html        # or double-click it

# option 2: tiny static server
npx serve .            # or: python3 -m http.server 8000
```

## Tests

```bash
bash test/smoke.sh   # 11 checks: files, syntax, plan invariants
bash test/e2e.sh     # 6 end-to-end flows exercising the scheduler
```

## Pricing vision

- **Free** — 1 active exam plan, everything local.
- **Plus ($8/mo)** — unlimited plans, cloud sync, AI explanations included, printable schedules.
- **Schools** — classroom licenses with teacher dashboards.

## Tech

Pure static HTML/CSS/JS. Zero dependencies. The scheduling core (`js/logic.js`) is framework-free and shared between the browser UI and the Node test suite.
