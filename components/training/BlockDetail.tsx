"use client";

import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";

// ============================================
// Types (match API response shapes)
// ============================================
export interface PhaseSummary {
  blockNumber: number;
  name: string;
  shortLabel: string;
  status: string;
  startDate: string;
  endDate: string;
  durationWeeks: number;
}

export interface BlockWeekSummary {
  weekNumber: number;
  title: string;
  description: string;
  totalKm: number;
  totalMin: number;
  isCurrent: boolean;
}

interface BlockStatus {
  currentBlockNumber: number;
  currentPhaseName: string;
  weekInBlock: number;
  weeksTotal: number;
  blockStartDate: string;
  blockEndDatePlanned: string;
}

interface BlockDetailProps {
  blockStatus: BlockStatus;
  blockWeeks: BlockWeekSummary[];
  phases: PhaseSummary[];
}

// ============================================
// BlockDetail — main export
// ============================================
export function BlockDetail({
  blockStatus,
  blockWeeks,
  phases,
}: BlockDetailProps) {
  const currentPhase = phases.find(
    (p) => p.blockNumber === blockStatus.currentBlockNumber,
  );

  return (
    <div className="px-6" style={{ paddingTop: 8, paddingBottom: 20 }}>
      {/* Rule separator */}
      <hr className="rule" style={{ margin: "0 0 20px 0" }} />

      {/* Block Header */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          Block {blockStatus.currentBlockNumber} ·{" "}
          {currentPhase?.shortLabel ?? blockStatus.currentPhaseName}
        </div>
        <div
          className="label"
          style={{ marginTop: 4, opacity: 0.5 }}
        >
          {formatDateRange(
            blockStatus.blockStartDate,
            blockStatus.blockEndDatePlanned,
          )}{" "}
          · {blockStatus.weeksTotal} Wochen
        </div>
      </div>

      {/* Phase Tabs */}
      <PhaseTabs
        phases={phases}
        currentBlockNumber={blockStatus.currentBlockNumber}
        weekInBlock={blockStatus.weekInBlock}
        weeksTotal={blockStatus.weeksTotal}
      />

      <div style={{ height: 20 }} />

      {/* WOCHEN section header */}
      <div className="section-h" style={{ padding: 0 }}>
        <span className="label">Wochen</span>
      </div>
      <div style={{ height: 10 }} />

      {/* Week rows */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {blockWeeks.map((week) => (
          <WeekRow key={week.weekNumber} week={week} />
        ))}
      </div>
    </div>
  );
}

// ============================================
// Phase Tabs
// ============================================
function PhaseTabs({
  phases,
  currentBlockNumber,
  weekInBlock,
  weeksTotal,
}: {
  phases: PhaseSummary[];
  currentBlockNumber: number;
  weekInBlock: number;
  weeksTotal: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        scrollbarWidth: "none",
      }}
    >
      {phases.map((phase) => {
        const isCompleted = phase.status === "completed";
        const isCurrent = phase.blockNumber === currentBlockNumber;
        const isFuture = !isCompleted && !isCurrent;

        return (
          <div
            key={phase.blockNumber}
            className="chip"
            style={{
              flexShrink: 0,
              borderLeft: isCurrent
                ? "2px solid var(--color-session-threshold)"
                : undefined,
              background: isCurrent
                ? "rgba(212, 168, 83, 0.06)"
                : undefined,
              opacity: isFuture ? 0.35 : isCompleted ? 0.5 : 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              minWidth: 64,
              padding: "8px 12px",
            }}
          >
            <span
              className="label"
              style={{
                margin: 0,
                color: isCurrent
                  ? "var(--color-session-threshold)"
                  : undefined,
              }}
            >
              {phase.shortLabel}
            </span>
            <span
              className="label"
              style={{
                margin: 0,
                fontSize: 9,
                opacity: 0.7,
              }}
            >
              {isCompleted
                ? "✓"
                : isCurrent
                  ? `W${weekInBlock}/${weeksTotal}`
                  : "→"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Week Row
// ============================================
function WeekRow({ week }: { week: BlockWeekSummary }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 0",
        borderBottom: "1px solid var(--color-rule)",
        borderLeft: week.isCurrent
          ? "2px solid var(--color-session-threshold)"
          : "2px solid transparent",
        paddingLeft: week.isCurrent ? 10 : 12,
        background: week.isCurrent
          ? "rgba(212, 168, 83, 0.04)"
          : undefined,
      }}
    >
      {/* Week number */}
      <span
        className="label"
        style={{
          margin: 0,
          width: 28,
          flexShrink: 0,
          paddingTop: 2,
          color: week.isCurrent
            ? "var(--color-session-threshold)"
            : undefined,
        }}
      >
        W{week.weekNumber}
      </span>

      {/* Title + description */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          {week.title}
        </div>
        <div
          className="label"
          style={{ margin: 0, marginTop: 2, opacity: 0.5 }}
        >
          {week.description}
        </div>
      </div>

      {/* km total */}
      <span
        className="num"
        style={{
          fontSize: 13,
          flexShrink: 0,
          color: week.isCurrent
            ? "var(--color-session-threshold)"
            : "var(--color-foreground-secondary)",
        }}
      >
        {week.totalKm > 0 ? `${week.totalKm}` : "—"}
        {week.totalKm > 0 && (
          <span style={{ fontSize: 10, opacity: 0.6 }}> km</span>
        )}
      </span>
    </div>
  );
}

// ============================================
// Helpers
// ============================================
function formatDateRange(start: string, end: string): string {
  const s = parseISO(start);
  const e = parseISO(end);
  const fmt = (d: Date) =>
    format(d, "d MMM", { locale: de }).toUpperCase();
  return `${fmt(s)} – ${fmt(e)}`;
}
