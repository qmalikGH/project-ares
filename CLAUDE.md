@AGENTS.md

## Coaching-Issues
Aufträge aus dem Coaching-Chat kommen als GitHub-Issues mit Label `coach`.
- Bei Session-Start: `gh issue list --label coach --state open` prüfen und Q nennen, was offen ist.
- Branch `coach/<nr>-<slug>`, PRs nur mit `Refs #<nr>`. **Das Issue schließt der Coach nach seiner Abnahme**, nicht das Merge — sonst landet eine Abnahme in einem geschlossenen Issue.
- Abweichungen vom Briefing oder Rückfragen als Kommentar ins Issue — nicht still anders umsetzen.
- Nach Merge/Deploy: `regenerate-from-now` mit Garmin-Resync, dann im Issue kommentieren, was Q prüfen soll.
- Keine persönlichen Gesundheitsdaten (Gewicht, Schmerzwerte, HF-Werte) in Issues, PRs, Commits, Code-Kommentaren oder Test-Fixtures.
