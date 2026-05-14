"use client";

import { useState } from "react";
import Link from "next/link";
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
  allBlockWeeks: Record<number, BlockWeekSummary[]>;
  phases: PhaseSummary[];
}

// ============================================
// BlockDetail — main export
// ============================================
export function BlockDetail({
  blockStatus,
  allBlockWeeks,
  phases,
}: BlockDetailProps) {
  const [selectedBlock, setSelectedBlock] = useState(
    blockStatus.currentBlockNumber,
  );

  const selectedPhase = phases.find((p) => p.blockNumber === selectedBlock);
  const weeks = allBlockWeeks[selectedBlock] ?? [];
  const isCurrentBlock = selectedBlock === blockStatus.currentBlockNumber;

  // Collect all weeks across all blocks for the volume chart
  const allWeeksFlat: { km: number; blockNumber: number; isCurrent: boolean }[] = [];
  for (const phase of phases) {
    const bw = allBlockWeeks[phase.blockNumber] ?? [];
    for (const w of bw) {
      allWeeksFlat.push({
        km: w.totalKm,
        blockNumber: phase.blockNumber,
        isCurrent: w.isCurrent,
      });
    }
  }

  return (
    <div className="px-6" style={{ paddingTop: 8, paddingBottom: 20 }}>
      {/* Rule separator */}
      <hr className="rule" style={{ margin: "0 0 20px 0" }} />

      {/* Block Header */}
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Block {selectedBlock} ·{" "}
            {selectedPhase?.shortLabel ?? ""}
          </div>
          <div className="label" style={{ marginTop: 4, opacity: 0.5 }}>
            {selectedPhase
              ? `${formatDateRange(selectedPhase.startDate, selectedPhase.endDate)} · ${selectedPhase.durationWeeks} Wochen`
              : ""}
          </div>
        </div>
        <Link
          href="/progress"
          className="label"
          style={{ opacity: 0.5, paddingTop: 4 }}
        >
          Stats →
        </Link>
      </div>

      {/* Phase Tabs — clickable */}
      <PhaseTabs
        phases={phases}
        selectedBlock={selectedBlock}
        currentBlockNumber={blockStatus.currentBlockNumber}
        weekInBlock={blockStatus.weekInBlock}
        onSelect={setSelectedBlock}
      />

      {/* Volume bar chart */}
      {allWeeksFlat.length > 0 && (
        <>
          <div style={{ height: 20 }} />
          <VolumeChart
            weeks={allWeeksFlat}
            phases={phases}
            selectedBlock={selectedBlock}
          />
        </>
      )}

      <div style={{ height: 20 }} />

      {/* WOCHEN section header */}
      <div className="section-h" style={{ padding: 0 }}>
        <span className="label">Wochen</span>
      </div>
      <div style={{ height: 10 }} />

      {/* Week rows */}
      {weeks.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {weeks.map((week) => (
            <WeekRow
              key={week.weekNumber}
              week={week}
              highlight={isCurrentBlock}
            />
          ))}
        </div>
      ) : (
        <div className="label" style={{ opacity: 0.4, padding: "12px 0" }}>
          Noch keine Wochen geplant
        </div>
      )}
    </div>
  );
}

// ============================================
// Phase Tabs — clickable, switch block view
// ============================================
function PhaseTabs({
  phases,
  selectedBlock,
  currentBlockNumber,
  weekInBlock,
  onSelect,
}: {
  phases: PhaseSummary[];
  selectedBlock: number;
  currentBlockNumber: number;
  weekInBlock: number;
  onSelect: (blockNumber: number) => void;
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
        const isActive = phase.blockNumber === currentBlockNumber;
        const isSelected = phase.blockNumber === selectedBlock;
        const isFuture = !isCompleted && !isActive;

        return (
          <button
            key={phase.blockNumber}
            type="button"
            onClick={() => onSelect(phase.blockNumber)}
            className="chip"
            style={{
              flexShrink: 0,
              cursor: "pointer",
              border: isSelected
                ? "1px solid var(--color-session-threshold)"
                : "1px solid var(--color-rule)",
              background: isSelected
                ? "rgba(212, 168, 83, 0.08)"
                : undefined,
              opacity: isFuture && !isSelected ? 0.35 : isCompleted && !isSelected ? 0.5 : 1,
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
                color: isSelected
                  ? "var(--color-session-threshold)"
                  : undefined,
              }}
            >
              {phase.shortLabel}
            </span>
            <span
              className="label"
              style={{ margin: 0, fontSize: 9, opacity: 0.7 }}
            >
              {isCompleted
                ? "✓"
                : isActive
                  ? `W${weekInBlock}/${phase.durationWeeks}`
                  : "→"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// Volume Bar Chart
// ============================================
const BLOCK_COLORS: Record<number, string> = {
  1: "var(--color-session-easy)",
  2: "var(--color-session-threshold)",
  3: "var(--color-session-threshold)",
  4: "var(--color-session-vo2max)",
  5: "var(--color-session-vo2max)",
};

function VolumeChart({
  weeks,
  phases,
  selectedBlock,
}: {
  weeks: { km: number; blockNumber: number; isCurrent: boolean }[];
  phases: PhaseSummary[];
  selectedBlock: number;
}) {
  const maxKm = Math.max(...weeks.map((w) => w.km), 1);
  const currentIdx = weeks.findIndex((w) => w.isCurrent);

  return (
    <div>
      <div className="section-h" style={{ padding: 0 }}>
        <span className="label">Volumen-Verlauf</span>
        <span className="label" style={{ opacity: 0.5 }}>km / Woche</span>
      </div>
      <div style={{ height: 10 }} />
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          height: 80,
          position: "relative",
        }}
      >
        {weeks.map((w, i) => {
          const height = Math.max((w.km / maxKm) * 70, 2);
          const isInSelected = w.blockNumber === selectedBlock;
          const color = BLOCK_COLORS[w.blockNumber] ?? "var(--color-foreground-muted)";

          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              {/* km label on highlighted bars */}
              {isInSelected && w.km > 0 && (
                <span
                  className="num"
                  style={{
                    fontSize: 8,
                    opacity: 0.6,
                    lineHeight: 1,
                  }}
                >
                  {w.km}
                </span>
              )}
              {/* Bar */}
              <div
                style={{
                  width: "100%",
                  height,
                  borderRadius: 2,
                  backgroundColor: color,
                  opacity: isInSelected ? 0.9 : 0.25,
                  transition: "opacity 0.2s",
                }}
              />
            </div>
          );
        })}
      </div>
      {/* HEUTE marker */}
      {currentIdx >= 0 && (
        <div
          style={{
            display: "flex",
            gap: 3,
          }}
        >
          {weeks.map((_, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center" }}>
              {i === currentIdx && (
                <span
                  className="label"
                  style={{
                    margin: 0,
                    fontSize: 8,
                    color: "var(--color-session-threshold)",
                  }}
                >
                  HEUTE
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Week Row
// ============================================
function WeekRow({
  week,
  highlight,
}: {
  week: BlockWeekSummary;
  highlight: boolean;
}) {
  const showCurrent = highlight && week.isCurrent;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 0",
        borderBottom: "1px solid var(--color-rule)",
        borderLeft: showCurrent
          ? "2px solid var(--color-session-threshold)"
          : "2px solid transparent",
        paddingLeft: showCurrent ? 10 : 12,
        background: showCurrent
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
          color: showCurrent
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
          color: showCurrent
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
