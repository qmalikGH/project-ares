# Sprint v0.9 — Manual Test Plan

**Status:** Code shipped, manual verification pending. All five tests below
require physical hardware (iPhone 11 + Forerunner 165) and live Garmin Connect
data, so they can't run inside CI / the AI sandbox.

Run these in order after deploy lands. If any fails, file an issue under
`v0.9-followup` rather than rolling back — every Garmin path is best-effort
and the in-app plan still works without push.

---

## Test 1 — PWA install on iPhone 11

1. Open Safari → `https://project-ares-ruddy.vercel.app`
2. Share Sheet → "Zum Home-Bildschirm" → bestätigen.
3. Verify: Icon erscheint mit dunklem Background + cyan-glow "A" Symbol.
4. Tap Icon → öffnet im **Standalone-Mode** (kein Safari-Browser-UI sichtbar).
5. Status-Bar ist dunkel (`black-translucent`) und Inhalt fließt darunter.
6. Bottom-FloatingNav steht auf voller Höhe (kein Safari-Tab-Bar überlappt).

**Acceptance:** Icon + Standalone + Dark statusbar = ✅

---

## Test 2 — Garmin Push for tomorrow's Easy Run

1. App → /settings → "Garmin Workout Push" → Toggle aktivieren.
2. Auf "Diese Woche jetzt syncen" tippen.
3. Toast oder Inline-Status zeigt z.B. `2 synced · 5 skipped`.
4. Garmin Connect Mobile öffnen → Calendar → morgen sollte
   z.B. **"Easy Run 60min · HR 144-167"** erscheinen.
5. iPhone neben FR 165 legen, 1-5 Min auf Bluetooth-Sync warten.
6. Auf der Uhr: **Workout** App → **Heute** → Workout sichtbar.
7. Workout starten → Uhr piept wenn HR aus dem 144-167 Korridor läuft.

**Acceptance:** Workout im Calendar + Sync auf Uhr = ✅

---

## Test 3 — Auto-Adjust-Hook (deferred to v1.0)

Per Sprint v0.9 Scope wird der Auto-Adjust-Re-Push deferred — der Vorabend-
Cron pusht den Plan-Stand. Wenn /today auf Recovery-Basis modulationen
anwendet, bleibt das in der App und wird nicht zurück zur Uhr gepusht.

**Acceptance für v0.9:** N/A. (Test wird in v1.0 reaktiviert.)

---

## Test 4 — Strength-Session NICHT gepusht

1. Auf einem Strength-Tag (z.B. Mittwoch mit `strength_a`):
2. Cron oder "Diese Woche jetzt syncen" laufen lassen.
3. Garmin Connect Mobile → für Mittwoch sollte **kein Workout** erscheinen.
4. App `/today` zeigt Strength-Session normal in der App.

**Acceptance:** Strength bleibt nur in der App, Garmin-Calendar leer = ✅

---

## Test 5 — Auth-Failure-Robustness

1. In `.env.local` `GARMIN_PASSWORD` temporär ungültig machen.
2. Auf Settings "Diese Woche jetzt syncen" tippen.
3. Verify: Sync-Result zeigt `failed` mit Fehlermeldung.
4. App **crasht nicht**, Settings-UI bleibt funktional.
5. Workout-Rows in DB haben `garminPushStatus="failed"` und
   `garminPushError="..."`.
6. Password fixen, erneut syncen → recovery sauber, Status wechselt zu `synced`.

**Acceptance:** Graceful Failure ohne Crash, recovery klappt = ✅

---

## Notes

- **Sync-Latency:** Garmin Connect Mobile ↔ FR 165 sync ist Bluetooth-basiert
  und kann 15-60 Min dauern. Vorabend-Push (Cron 21:00 Berlin) gibt der Uhr
  bis zum Morgen ausreichend Zeit.
- **Strength + Time-Trial-Sessions** werden NIE gepusht — das ist hartkodiert
  in `lib/garmin/workout-builder.ts` (`NON_PUSHABLE_TYPES`).
- **Garmin Auth:** Garmin hat Frühjahr 2025 die Auth umgestellt. Wenn Tests
  schlagartig brechen, prüfe `lib/garmin/client.ts` und ggf. Library-Update.
