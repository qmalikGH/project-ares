---
name: Project Ares
description: Personal AI training coach for the self-coached athlete
colors:
  background: "#0A0A0B"
  surface: "#111113"
  surface-hover: "#18181B"
  foreground: "#F5F5F4"
  border: "rgba(255, 255, 255, 0.10)"
  rule: "rgba(255, 255, 255, 0.08)"
  accent-amber: "#D4A853"
  nav-accent: "#7DD3FC"
  session-easy: "#8B9E8B"
  session-threshold: "#D4A853"
  session-long: "#7B8EC2"
  session-vo2max: "#C25B5B"
  session-strength: "#8A8A8E"
  session-rest: "#3A3A3C"
  session-calibration: "#9B8EC2"
  success: "#6BBF7B"
  destructive: "#C25B5B"
typography:
  display:
    fontFamily: "Geist Mono, SF Mono, Fira Code, monospace"
    fontSize: "3.5rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "\"tnum\" 1"
  headline:
    fontFamily: "Geist, system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Geist, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Mono, SF Mono, monospace"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.05em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-cta:
    backgroundColor: "{colors.nav-accent}"
    textColor: "{colors.background}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  button-default:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  chip:
    backgroundColor: "rgba(255, 255, 255, 0.08)"
    textColor: "{colors.foreground}"
    rounded: "3px"
    padding: "2px 8px"
---

# Design System: Project Ares

## 1. Overview

**Creative North Star: "The Training Block"**

Project Ares is designed like a periodized training plan made visible: structured, measured, and free of noise. Every screen has a single primary job — check in, log, review — and the interface enforces that discipline through generous negative space, hard divider lines instead of cards, and monospace numerals that dominate the visual hierarchy. The surface is dark because the athlete using this is checking it post-run or late at night; not a brand statement, but a functional answer to context.

The system rejects the default posture of fitness software: no dashboard grids stacked with stats, no gradient fills that pulse with motivation, no neon accents that announce themselves. Information earns its right to be on screen. What cannot pass that test is removed.

The "Athletic Topographic" direction (codename Direction C) uses session-type colors as its only categorical accent vocabulary. These colors do not decorate — they encode. Amber means threshold. Brick red means VO2max. They are never used for decoration or brand expression. The one true accent is a warm amber that doubles as the system focus ring and threshold indicator, binding data identity to accessibility in one token.

**Key Characteristics:**
- Near-black ground with tonal surface layering; no shadows on content
- Dual typography: Geist sans for prose and labels, Geist Mono for all numeric output
- Seven session-type colors as the only categorical encoding vocabulary
- Horizontal rule dividers as the primary structural tool, not cards
- Glass pill floating navigation — the single purposeful glassmorphism exception
- Mobile-first layout with full iOS safe-area awareness

## 2. Colors: The Tonal Ground

The palette is almost entirely neutral. Seven categorical session-type colors serve as the only deliberate accent vocabulary. There is no brand color in the conventional sense.

### Primary

- **Threshold Amber** (`#D4A853`): The system's one true accent. Used as the CSS focus ring, the threshold session type indicator, and the warning state. Its rarity is the point — when amber appears, something requires attention.

### Secondary

- **Navigation Sky** (`#7DD3FC`): Sky cyan used exclusively within the FloatingNav for the active state: icon color, label color, and active pill background tint. It does not appear anywhere else in the interface.

### Session Vocabulary

These colors encode session type. They are never used for decoration.

- **Sage Easy** (`#8B9E8B`): Easy / aerobic sessions. Muted sage green.
- **Threshold Amber** (`#D4A853`): Threshold sessions. Shared with the primary accent.
- **Steel Long** (`#7B8EC2`): Long runs. Desaturated steel indigo.
- **Brick VO2max** (`#C25B5B`): VO2max / intervals. Brick red. Maps to `--color-destructive`.
- **Slate Strength** (`#8A8A8E`): Strength sessions. Cool neutral slate.
- **Charcoal Rest** (`#3A3A3C`): Rest days. Near-invisible charcoal — intentionally recessive.
- **Violet Calibration** (`#9B8EC2`): Calibration / testing blocks. Muted violet.

### Neutral

- **Void Ground** (`#0A0A0B`): Page background. Not pure black — a near-black with a trace of warmth.
- **Lifted Surface** (`#111113`): Component and section background. One tonal step above ground.
- **Hover Surface** (`#18181B`): Interactive surface hover state.
- **Foreground** (`#F5F5F4`): Primary text. Off-white with a warm tint; never pure white.
- **Foreground Secondary** (`rgba(245,245,244,0.70)`): Supporting labels, secondary metadata.
- **Foreground Tertiary** (`rgba(245,245,244,0.50)`): Placeholder text, inactive nav icons.
- **Foreground Muted** (`rgba(245,245,244,0.35)`): Disabled states, deeply de-emphasized content.
- **Rule** (`rgba(255,255,255,0.08)`): Horizontal dividers. The primary structural tool. Invisible at a distance; present on close inspection.
- **Border** (`rgba(255,255,255,0.10)`): Component borders where structurally necessary.

### Named Rules

**The One Accent Rule.** Amber (`#D4A853`) is the only color used outside the session-type categorical vocabulary. It appears on 5% or less of any given screen. Introducing a new accent color for brand expression, visual interest, or additional hierarchy is prohibited.

**The Data Encoding Rule.** Session-type colors exist to identify session types. They do not decorate callouts, alerts, category labels, or any UI element that is not literally identifying a training session type. Every non-session use of these colors is a mistake.

## 3. Typography

**Body / UI Font:** Geist (system-ui, -apple-system fallback)
**Numeric / Display Font:** Geist Mono (SF Mono, Fira Code fallback)

**Character:** Two fonts, one job each. Geist handles all prose, labels, navigation, and UI copy. Geist Mono handles every number that matters — pace, heart rate, weight, distance, percentages. The switch between them is instant and deliberate; wherever Mono appears, a measured value is being communicated.

### Hierarchy

- **Display** (Geist Mono, 500w, 3.5rem, lh 1, ls -0.03em, `tnum`): Hero metrics on day and session screens. HR, pace, distance in large format. Tabular numeric alignment required.
- **Headline** (Geist, 600w, 1.25rem, lh 1.2, ls -0.01em): Screen titles, major section headings.
- **Title** (Geist, 600w, 1rem, lh 1.3): Session names, block phase names, card-level headings.
- **Body** (Geist, 400w, 0.875rem, lh 1.5): Prose content, coach messages, goal descriptions. Max line length 65ch on desktop.
- **Label** (Geist Mono, 600w, 0.6875rem, lh 1.4, ls 0.05em, uppercase): Chip labels, session type tags, status indicators.

### Named Rules

**The Mono Numerals Rule.** Every numeric value in the interface uses Geist Mono with `font-variant-numeric: tabular-nums`. No exceptions. A number rendered in Geist sans is always a mistake.

**The Scale Contract.** Headline (1.25rem) to Body (0.875rem) is a 1.43× ratio. Do not introduce sizes that compress this below 1.2×. Flat typographic scales remove hierarchy.

## 4. Elevation

This system is flat by default. Depth is conveyed through tonal surface layering — Ground (`#0A0A0B`), Surface (`#111113`), Hover (`#18181B`) — not through shadows. Content components do not cast shadows; they inhabit a tonal tier.

Two purposeful exceptions exist. The FloatingNav uses `box-shadow: 0 8px 32px -4px rgba(0,0,0,0.6)` and `backdrop-filter: blur(20px)` to float visibly above page content — a navigation affordance, not decoration. The PrimaryButton CTA uses a focused sky-cyan glow to signal it as the screen's primary action.

### Shadow Vocabulary

- **Nav float** (`0 8px 32px -4px rgba(0,0,0,0.6)` + `backdrop-blur(20px)`): FloatingNav only. Signals persistent navigation layer above all content.
- **CTA glow** (`0 4px 24px -4px rgba(125,211,252,0.4)`): PrimaryButton only. Confirms the screen's single primary action.

### Named Rules

**The Flat-By-Default Rule.** If you are reaching for `box-shadow` on any component other than FloatingNav or PrimaryButton, stop. Use a border or a surface color step instead. Shadows are reserved vocabulary; exhausting them on generic surfaces removes their meaning.

## 5. Components

### Buttons

Three variants serve distinct weight tiers:

- **Primary CTA (PrimaryButton):** Full-width pill (9999px radius), 48px tall. Sky-cyan fill (`#7DD3FC`) with near-black text. Cyan glow shadow (`0 4px 24px -4px rgba(125,211,252,0.4)`). Used for the screen's single primary action: start session, complete workout. One per screen.
- **Default Button:** 32px tall, 8px radius, foreground fill (`#F5F5F4`) with near-black text. Inset highlight at top edge (`inset 0 1px 0 0 rgba(255,255,255,0.4)`). Scales to 97% on `:active`. Transitions at 150ms.
- **Ghost Button:** Transparent background, foreground text. Hover adds `rgba(255,255,255,0.04)` background tint. Low visual weight; secondary and destructive actions.
- **Focus (all):** Amber ring `rgba(212,168,83,0.5)`, 2px solid, 2px offset, via `:focus-visible`. Radius matches the element.

### Chips

Uppercase label chips: 11px, Geist Mono, 600w, 0.05em tracking, 3px radius, `rgba(255,255,255,0.08)` background. Used for session type tags, status states, and categorical labels. They read as data, not as decorative pills.

### Cards / Containers

This system does not use conventional cards as the primary layout tool. The default structural unit is a horizontal rule divider (`.rule`, 1px, `rgba(255,255,255,0.08)`) separating rows within a section. When a true container is needed, the Lifted Surface color (`#111113`) against the Ground (`#0A0A0B`) provides containment without a border. Border radius: 8px for content surfaces; no radius on full-width rows.

### Inputs / Fields

Stroke style: 1px border (`rgba(255,255,255,0.10)`) on transparent-to-dark background. Focus: amber ring (`rgba(212,168,83,0.4)`) replaces default border. Error: brick red border and ring (`#C25B5B`). Internal padding follows the 8px / 16px spacing rhythm.

### Navigation

FloatingNav is a glass pill (`backdrop-blur: 20px`, `background: rgba(10,10,11,0.70)`), bottom-fixed on mobile, top-center on desktop. Active state: sky-cyan icon and label inside a cyan-muted background pill (`rgba(125,211,252,0.12)`). Inactive items use foreground-tertiary icons with hidden labels on mobile (label reveals via `max-width` transition on activation). All transitions use `cubic-bezier(0.16, 1, 0.3, 1)` at 200ms.

### Session Stripe Indicator

A 3px left border colored by session type with 12px internal padding-left. Used exclusively on calendar cells and day cards to identify session type at a glance. This is the only intentional side-stripe in the system — it exists for categorical data encoding, not general decoration. Do not repurpose for callouts, alerts, or any non-session context.

### Numeric Display

Four scale classes for metric values (all Geist Mono, tabular-nums, `font-feature-settings: "tnum" 1`):

- **num-hero** (3.5rem, 500w, ls -0.03em, lh 1): Primary screen metric — HR, pace, key daily number.
- **num-lg** (1.75rem, 500w, ls -0.02em, lh 1.1): Section-level metrics.
- **num-md** (1.125rem, 500w, ls -0.01em, lh 1.2): Inline metrics within content rows.
- **num** (inherited size, 500w, ls -0.02em): Any numeric value in a body context.

## 6. Do's and Don'ts

### Do:

- **Do** leave generous vertical space between sections. Breathing room between a session title and its stats is functional — it prevents the cramped-table feel this app explicitly rejects.
- **Do** use horizontal rule dividers (`.rule`, 1px, `rgba(255,255,255,0.08)`) as the default structural separator. Dividers first, cards only when the content genuinely requires containment.
- **Do** render all numeric values in Geist Mono with `tabular-nums`. Pace, HR, distance, duration, percentages — Mono, always.
- **Do** use session-type colors strictly to identify session types. Amber for threshold, brick red for VO2max, sage for easy. Their meaning is their value.
- **Do** design for 390px first. If a layout works at 390px width, it works. Desktop is additive, not the base case.
- **Do** keep PrimaryButton to one per screen. It is the screen's single primary action. Two primary buttons means neither is primary.
- **Do** use `cubic-bezier(0.16, 1, 0.3, 1)` for state transitions. Fast in, slow exit. No bounce, no elastic.

### Don't:

- **Don't** use neon on dark backgrounds. The neon-fitness-app aesthetic (Whoop, Mirror) is the primary anti-reference. No glowing rings, no electric accent trails, no saturated fills on non-CTA elements.
- **Don't** replicate Garmin Connect's data density. No tables with 8 metrics side by side. No timeline rows with truncated text. One metric wins; others support.
- **Don't** replicate TrainingPeaks' clinical grey grid. Dense chart panels, tiny labeling, clinical neutrality — the system is austere, not clinical.
- **Don't** use gradient text (`background-clip: text`). All text is a single solid foreground color. Emphasis through weight and scale.
- **Don't** use glassmorphism decoratively. The FloatingNav pill is the only blur in the system. Blurred cards, frosted panels, glass modals — none belong here.
- **Don't** build identical card grids. Icon + heading + text, repeated 6 times. Every grid is a missed opportunity for hierarchy.
- **Don't** use the hero-metric SaaS dashboard template: big number, small label, supporting stats, gradient accent pill. Numbers in this system live in context, not as self-congratulatory tiles.
- **Don't** add a new accent color. The system has amber for functional accent, sky-cyan for nav active, and seven session colors for categorical data. There is no room for a secondary brand color or a highlight that does not fit one of these defined roles.
- **Don't** use side-stripe borders (`border-left > 1px`) outside of the session-stripe component. Session stripes are specific categorical encoding; they are not a general-purpose callout or alert pattern.
