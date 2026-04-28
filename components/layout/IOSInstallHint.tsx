"use client";

// IOSInstallHint (Sprint v0.9) — gentle one-shot tooltip nudging Q to add
// the app to his iPhone home screen. Only shown when:
//   - User-Agent matches iOS Safari
//   - App is NOT already running in standalone mode
//   - User hasn't dismissed it before (localStorage flag)
//
// Apple doesn't expose a programmatic install prompt on iOS — only this kind
// of manual hint is possible.
import { useEffect, useState } from "react";

const DISMISS_KEY = "ios-install-dismissed";
const DELAY_MS = 3_000;

export function IOSInstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = window.navigator.userAgent;
    const isiOS = /iPad|iPhone|iPod/.test(ua);
    if (!isiOS) return;

    // iOS Safari sets navigator.standalone === true once installed.
    const standaloneNav = (
      window.navigator as Navigator & { standalone?: boolean }
    ).standalone;
    const standaloneMql = window.matchMedia?.(
      "(display-mode: standalone)",
    ).matches;
    if (standaloneNav === true || standaloneMql) return;

    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "true";
    } catch {
      /* private browsing throws — show anyway */
    }
    if (dismissed) return;

    const timer = window.setTimeout(() => setShow(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div
      className="glass-card fixed bottom-24 left-4 right-4 z-50 p-4 sm:right-4 sm:bottom-32 sm:left-auto sm:max-w-sm"
      role="dialog"
      aria-labelledby="ios-install-title"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h3 id="ios-install-title" className="text-sm font-medium text-foreground">
            Als App installieren
          </h3>
          <p className="mt-1 text-xs text-foreground-secondary">
            Tippe auf{" "}
            <span className="inline-block align-middle text-[var(--accent)]">⎋</span>{" "}
            <em>Teilen</em> → <em>Zum Home-Bildschirm</em> für Vollbild ohne
            Safari-UI.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShow(false);
            try {
              window.localStorage.setItem(DISMISS_KEY, "true");
            } catch {
              /* noop */
            }
          }}
          className="text-xl leading-none text-foreground-tertiary hover:text-foreground"
          aria-label="Hinweis schließen"
        >
          ×
        </button>
      </div>
    </div>
  );
}
