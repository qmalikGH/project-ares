# Ares — AI Training Coach

An AI-powered personal training coach that turns raw **Garmin** data into
focused, day-by-day coaching. Ares connects wearable data, periodized block
planning, and workout logging in one mobile-first place — and uses a Claude-based
coaching engine to translate the numbers into a clear plan for the next session.

The design philosophy is deliberate restraint: where Garmin Connect and
TrainingPeaks cram in dashboards, Ares shows **one clear thing at a time**.

> **Status:** Personal project. Built to explore how far an LLM coaching layer
> can go when it sits directly on top of real, continuous training data.

---

## What it does

- **Garmin integration** — pulls activities, sensor data, and daily metrics from
  Garmin Connect into a structured Postgres model.
- **AI coaching engine** — a Claude-backed engine reviews recent training load and
  generates the next session, adapting periodized *blocks* over time.
- **Block planning** — periodized, goal-oriented training blocks rather than
  one-off workouts.
- **Daily view** — a single focused screen per day: what to do, why, and how it
  fits the block.
- **Progress & goals** — trends and goal tracking without dashboard overload.
- **Nutrition & notifications** — lightweight logging and timely nudges.
- **Scheduled jobs** — cron endpoints keep data and coaching state fresh.

## Tech stack

| Layer        | Choice                                                            |
| ------------ | ----------------------------------------------------------------- |
| Framework    | [Next.js 16](https://nextjs.org) (App Router), React 19           |
| Language     | TypeScript                                                        |
| AI           | [Anthropic Claude SDK](https://docs.anthropic.com) (coaching engine) |
| Data         | PostgreSQL via [Prisma](https://www.prisma.io)                    |
| Auth         | [NextAuth](https://authjs.dev) (v5)                               |
| Wearables    | Garmin Connect                                                    |
| UI           | Tailwind CSS + shadcn/ui + Radix, Recharts                        |
| Validation   | Zod                                                               |
| Testing      | Vitest + Testing Library                                          |
| Deploy       | Vercel                                                            |

## Architecture at a glance

```
app/(app)/…      → mobile-first screens (today, week, blocks, coach, progress…)
app/api/…        → route handlers (garmin sync, coach, cron, sessions, goals…)
lib/garmin       → Garmin Connect ingestion
lib/coach-engine → periodized planning logic
lib/ai-coach     → Claude prompt/response layer
prisma/          → schema + migrations (PostgreSQL)
```

## Getting started

```bash
# 1. Install
npm install

# 2. Configure environment (see .env.example)
cp .env.example .env
#   → fill in DATABASE_URL, ANTHROPIC_API_KEY, Garmin credentials, etc.

# 3. Set up the database
npx prisma migrate dev

# 4. Run
npm run dev          # http://localhost:3000
```

### Useful scripts

| Command             | Purpose                           |
| ------------------- | --------------------------------- |
| `npm run dev`       | Start the dev server              |
| `npm run build`     | Prisma generate + migrate + build |
| `npm run test`      | Run the test suite (Vitest)       |
| `npm run typecheck` | Type-check without emitting       |
| `npm run lint`      | Lint with ESLint                  |

## Design principles

1. **Breathing room is functional** — space is signal, not waste.
2. **Phone-first, always** — if it's cramped at 390px, it's broken.
3. **One job per screen** — secondary data reveals on demand.
4. **Numbers are the hero** — values take precedence over chrome.
5. **Earn every pixel** — no decorative elements.

## License

Personal project — all rights reserved. Feel free to browse for reference.
