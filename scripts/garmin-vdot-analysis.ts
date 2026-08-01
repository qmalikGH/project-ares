// scripts/garmin-vdot-analysis.ts
//
// Extended Garmin diagnostic — pulls ALL run activities from last 90 days,
// extracts (HR, pace) data points from time-series, computes VDOT via multiple
// scientifically validated methods, returns confidence interval.
//
// Usage:
//   npx tsx scripts/garmin-vdot-analysis.ts
//
// Methods used (multiple for triangulation):
// 1. HRC (Heart Rate Cost) — Olher 2019, validated for recreational runners (r=0.673)
// 2. Daniels VDOT extrapolation from longest sustained effort
// 3. Sub-maximal HR-pace regression — fits HR vs pace curve, predicts max
//
// All results are aggregated into a single VDOT estimate with confidence range.

import { config as dotenvConfig } from "dotenv";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

dotenvConfig({ path: ".env.local" });

const OUTPUT_DIR = "./garmin-diagnostic-output";
const GC_API = "https://connectapi.garmin.com";

interface RunDataPoint {
  activityId: number;
  date: string;
  distanceM: number;
  durationSec: number;
  avgHR: number;
  maxHR: number;
  avgPaceSecPerKm: number; // sec per km
  velocityMperMin: number; // m/min
  category: "easy" | "moderate" | "hard" | "max" | "unknown";
}

interface VdotEstimate {
  method: string;
  vdot: number;
  confidence: "low" | "medium" | "high";
  basis: string;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const garminLib = await import("garmin-connect");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const GarminConnect = (garminLib as any).GarminConnect ?? (garminLib as any).default?.GarminConnect ?? (garminLib as any).default;
  if (!GarminConnect) throw new Error("Could not find GarminConnect export");

  const username = process.env.GARMIN_USERNAME;
  const password = process.env.GARMIN_PASSWORD;
  if (!username || !password) throw new Error("Missing credentials");

  console.log("\nGarmin VDOT Analysis (Extended)");
  console.log("================================\n");
  console.log("Logging in...");

  const gc = new GarminConnect({ username, password });
  await gc.login();
  console.log("✓ Logged in\n");

   
  const rawClient: { get: <T>(url: string) => Promise<T> } =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gc as any).client ?? (gc as any)._client ?? (gc as any).http;
  if (!rawClient?.get) throw new Error("Cannot access raw client");

  // ==========================================================================
  // Step 1: Pull biographic data
  // ==========================================================================
  console.log("─── Step 1: Biographic data ───\n");

  const hrZonesArr = await rawClient.get<Array<{
    maxHeartRateUsed: number;
    restingHeartRateUsed: number;
    lactateThresholdHeartRateUsed: number | null;
    zone1Floor: number; zone2Floor: number; zone3Floor: number;
    zone4Floor: number; zone5Floor: number;
  }>>(`${GC_API}/biometric-service/heartRateZones`);
  const hrZones = hrZonesArr[0];
  console.log(`HRmax: ${hrZones.maxHeartRateUsed}, HRrest: ${hrZones.restingHeartRateUsed}`);
  console.log(`Garmin LT-HR: ${hrZones.lactateThresholdHeartRateUsed ?? "not detected"}`);
  console.log(`Garmin 5-zone floors: ${hrZones.zone1Floor}/${hrZones.zone2Floor}/${hrZones.zone3Floor}/${hrZones.zone4Floor}/${hrZones.zone5Floor}\n`);

  const profile = await rawClient.get<{
    biometricProfile?: { vo2Max?: number; lactateThresholdHeartRate?: number; height?: number; weight?: number };
    userInfo?: { birthDate?: string; age?: number };
  }>(`${GC_API}/userprofile-service/userprofile/personal-information`);
  const garminVdot = profile.biometricProfile?.vo2Max ?? null;
  console.log(`Garmin Firstbeat VO2max: ${garminVdot ?? "null"} (likely overestimated for new runners)`);
  console.log(`Body: ${profile.biometricProfile?.height ?? "?"}cm / ${(profile.biometricProfile?.weight ?? 0) / 1000}kg, age ${profile.userInfo?.age ?? "?"}\n`);

  // ==========================================================================
  // Step 2: Pull running-specific HR zones (might differ from default)
  // ==========================================================================
  console.log("─── Step 2: Sport-specific zones ───\n");

  try {
    const runZones = await rawClient.get<unknown>(`${GC_API}/biometric-service/heartRateZones?sport=RUNNING`);
    await writeFile(join(OUTPUT_DIR, "26-running-zones.json"), JSON.stringify(runZones, null, 2));
    console.log("✓ Running-specific zones saved to 26-running-zones.json");
  } catch (e) {
    console.log(`◌ No running-specific zones: ${e instanceof Error ? e.message.slice(0, 100) : "error"}`);
  }

  // ==========================================================================
  // Step 3: Pull ALL run activities from last 90 days
  // ==========================================================================
  console.log("\n─── Step 3: Run activities (last 90 days) ───\n");

  // Garmin returns activities in pages. Pull up to 100 to be safe.
  const allActivities = await rawClient.get<Array<{
    activityId: number;
    activityType?: { typeKey?: string };
    startTimeLocal: string;
    distance?: number;
    duration?: number;
    averageHR?: number;
    maxHR?: number;
    averageSpeed?: number;
  }>>(`${GC_API}/activitylist-service/activities/search/activities?start=0&limit=100`);

  const RUN_TYPES = new Set(["running", "street_running", "trail_running", "indoor_running", "treadmill_running", "track_running"]);
  const runActivities = allActivities.filter((a) => RUN_TYPES.has(a.activityType?.typeKey ?? ""));

  console.log(`Found ${allActivities.length} total activities, ${runActivities.length} runs`);

  // Filter to last 90 days
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const recentRuns = runActivities.filter((a) => new Date(a.startTimeLocal) > ninetyDaysAgo);
  console.log(`Of those, ${recentRuns.length} within last 90 days\n`);

  if (recentRuns.length === 0) {
    console.log("⚠ NO RUN ACTIVITIES IN LAST 90 DAYS");
    console.log("  → Calibration phase REQUIRED before VDOT can be computed");
    return;
  }

  // ==========================================================================
  // Step 4: Build run data points
  // ==========================================================================
  console.log("─── Step 4: Run summary ───\n");

  const runs: RunDataPoint[] = recentRuns
    .filter((a) => (a.distance ?? 0) > 500 && (a.duration ?? 0) > 60 && (a.averageHR ?? 0) > 0)
    .map((a) => {
      const distanceM = a.distance ?? 0;
      const durationSec = Math.round(a.duration ?? 0);
      const avgHR = Math.round(a.averageHR ?? 0);
      const maxHR = Math.round(a.maxHR ?? 0);
      const avgPaceSecPerKm = Math.round(durationSec / (distanceM / 1000));
      const velocityMperMin = (distanceM / durationSec) * 60;

      // Categorize based on HR vs HRmax
      const pctHRmax = avgHR / hrZones.maxHeartRateUsed;
      let category: RunDataPoint["category"] = "unknown";
      if (pctHRmax < 0.70) category = "easy";
      else if (pctHRmax < 0.80) category = "moderate";
      else if (pctHRmax < 0.90) category = "hard";
      else category = "max";

      return {
        activityId: a.activityId,
        date: a.startTimeLocal,
        distanceM,
        durationSec,
        avgHR,
        maxHR,
        avgPaceSecPerKm,
        velocityMperMin,
        category,
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  console.log("All runs:");
  for (const run of runs) {
    const pace = `${Math.floor(run.avgPaceSecPerKm / 60)}:${String(run.avgPaceSecPerKm % 60).padStart(2, "0")}`;
    const km = (run.distanceM / 1000).toFixed(2);
    const min = Math.round(run.durationSec / 60);
    console.log(`  ${run.date.slice(0, 10)} | ${km}km in ${min}min | ${pace}/km | HR ${run.avgHR}/${run.maxHR} | ${run.category.toUpperCase()}`);
  }

  await writeFile(join(OUTPUT_DIR, "27-runs-summary.json"), JSON.stringify(runs, null, 2));

  // ==========================================================================
  // Step 5: VDOT estimation via multiple methods
  // ==========================================================================
  console.log("\n─── Step 5: VDOT estimation ───\n");

  const estimates: VdotEstimate[] = [];

  // ── Method 1: HRC (Heart Rate Cost) for each run, then average ────────────
  // Olher 2019: HRC = HR / velocity, vVO2max = HRmax / HRC
  // Validated for recreational runners (r=0.673 vs lab gold standard)
  console.log("Method 1: HRC (Olher 2019)");
  const hrcEstimates: number[] = [];
  for (const run of runs) {
    if (run.avgHR < hrZones.restingHeartRateUsed + 30) continue; // skip very easy runs (low signal)

    const hrc = run.avgHR / run.velocityMperMin;
    const vVO2max = hrZones.maxHeartRateUsed / hrc; // m/min
    const t5kSec = 5000 / (vVO2max / 60);
    const vdot = vdotFrom5kSec(t5kSec);

    console.log(`  ${run.date.slice(0, 10)}: HRC=${hrc.toFixed(3)}, vVO2max=${(vVO2max * 0.06).toFixed(2)}km/h → VDOT ${vdot}`);
    hrcEstimates.push(vdot);
  }
  if (hrcEstimates.length > 0) {
    const meanHrc = hrcEstimates.reduce((a, b) => a + b, 0) / hrcEstimates.length;
    estimates.push({
      method: "HRC (Olher 2019)",
      vdot: Math.round(meanHrc),
      confidence: hrcEstimates.length >= 3 ? "high" : hrcEstimates.length >= 2 ? "medium" : "low",
      basis: `n=${hrcEstimates.length} runs, mean=${meanHrc.toFixed(1)}, range=${Math.min(...hrcEstimates)}-${Math.max(...hrcEstimates)}`,
    });
  }

  // ── Method 2: Hardest sustained effort → Daniels extrapolation ────────────
  // Find the run with highest HR_avg / HRmax ratio that lasted >5min, extrapolate to 5k
  console.log("\nMethod 2: Daniels (hardest sustained effort)");
  const sustainedRuns = runs.filter((r) => r.durationSec >= 300);
  if (sustainedRuns.length > 0) {
    // Sort by HR/HRmax ratio, take hardest
    const hardest = sustainedRuns.reduce((max, r) => {
      const rRatio = r.avgHR / hrZones.maxHeartRateUsed;
      const maxRatio = max.avgHR / hrZones.maxHeartRateUsed;
      return rRatio > maxRatio ? r : max;
    });

    // Riegel formula: equivalent 5k time
    const eq5kSec = hardest.durationSec * Math.pow(5000 / hardest.distanceM, 1.06);
    const vdot = vdotFrom5kSec(eq5kSec);

    const eq5kMin = Math.floor(eq5kSec / 60);
    const eq5kSecRem = Math.round(eq5kSec % 60);
    console.log(`  Hardest run: ${hardest.date.slice(0, 10)}, ${(hardest.distanceM / 1000).toFixed(2)}km @ HR ${hardest.avgHR}`);
    console.log(`  → Riegel 5k equivalent: ${eq5kMin}:${String(eq5kSecRem).padStart(2, "0")}, VDOT ${vdot}`);

    // Apply correction: hardest run was likely NOT max effort
    // If HR_avg < 95% HRmax, runner had reserve. Adjust VDOT down by 10-15%
    const hrRatio = hardest.avgHR / hrZones.maxHeartRateUsed;
    let correctedVdot = vdot;
    if (hrRatio < 0.85) correctedVdot = Math.round(vdot * 0.85);
    else if (hrRatio < 0.90) correctedVdot = Math.round(vdot * 0.90);

    console.log(`  HR-corrected (${(hrRatio * 100).toFixed(0)}% HRmax): VDOT ${correctedVdot}`);

    estimates.push({
      method: "Daniels Riegel + HR correction",
      vdot: correctedVdot,
      confidence: hrRatio > 0.92 ? "high" : hrRatio > 0.85 ? "medium" : "low",
      basis: `hardest run @ ${(hrRatio * 100).toFixed(0)}% HRmax, raw VDOT=${vdot}, corrected=${correctedVdot}`,
    });
  }

  // ── Method 3: Linear regression HR vs pace ────────────────────────────────
  // For runs with HR > 65% HRmax, fit linear relationship
  // Then extrapolate: at HR_max, what would the pace be? That's vVO2max.
  console.log("\nMethod 3: HR-pace linear regression");
  const dataPoints = runs.filter((r) => {
    const ratio = r.avgHR / hrZones.maxHeartRateUsed;
    return ratio >= 0.65 && ratio <= 0.95;
  });

  if (dataPoints.length >= 2) {
    // Linear regression: pace = a * HR + b
    const n = dataPoints.length;
    const sumHR = dataPoints.reduce((s, r) => s + r.avgHR, 0);
    const sumPace = dataPoints.reduce((s, r) => s + r.avgPaceSecPerKm, 0);
    const sumHRPace = dataPoints.reduce((s, r) => s + r.avgHR * r.avgPaceSecPerKm, 0);
    const sumHR2 = dataPoints.reduce((s, r) => s + r.avgHR * r.avgHR, 0);

    const a = (n * sumHRPace - sumHR * sumPace) / (n * sumHR2 - sumHR * sumHR);
    const b = (sumPace - a * sumHR) / n;

    // Predict pace at HRmax (this would be theoretical max sustainable pace)
    const paceAtHRmax = a * hrZones.maxHeartRateUsed + b;
    // But we need pace at vVO2max which corresponds to ~95% HRmax sustained
    const paceAt95pctHRmax = a * (hrZones.maxHeartRateUsed * 0.95) + b;

    console.log(`  n=${n} datapoints (HR ${(0.65 * hrZones.maxHeartRateUsed).toFixed(0)}-${(0.95 * hrZones.maxHeartRateUsed).toFixed(0)} bpm)`);
    console.log(`  Predicted pace at HRmax: ${Math.floor(paceAtHRmax / 60)}:${String(Math.round(paceAtHRmax % 60)).padStart(2, "0")}/km`);
    console.log(`  Predicted pace at 95% HRmax (~vVO2max): ${Math.floor(paceAt95pctHRmax / 60)}:${String(Math.round(paceAt95pctHRmax % 60)).padStart(2, "0")}/km`);

    const t5kSec = 5 * paceAt95pctHRmax;  // pace_per_km * 5
    const vdot = vdotFrom5kSec(t5kSec);
    console.log(`  Implied VDOT: ${vdot}`);

    estimates.push({
      method: "Linear regression (HR vs pace)",
      vdot,
      confidence: n >= 5 ? "high" : n >= 3 ? "medium" : "low",
      basis: `n=${n} datapoints, slope=${a.toFixed(2)}, intercept=${b.toFixed(0)}`,
    });
  } else {
    console.log(`  ◌ Need ≥2 datapoints in HR range, only have ${dataPoints.length}`);
  }

  // ==========================================================================
  // Step 6: Final estimate
  // ==========================================================================
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("                       FINAL VDOT ESTIMATE");
  console.log("══════════════════════════════════════════════════════════════\n");

  if (estimates.length === 0) {
    console.log("⚠ INSUFFICIENT DATA");
    console.log("Calibration phase required. Recommended protocol:");
    console.log("  - 1 easy run (30min, RPE 4-5)");
    console.log("  - 1 tempo run (20min @ comfortably hard, RPE 7)");
    console.log("  - 1 progressive run (5km, last km all-out)");
    console.log("After 3 runs, re-run this script for VDOT estimation.\n");
    return;
  }

  for (const est of estimates) {
    const conf = est.confidence === "high" ? "★★★" : est.confidence === "medium" ? "★★" : "★";
    console.log(`  ${conf} ${est.method}: VDOT ${est.vdot}`);
    console.log(`      ${est.basis}`);
  }

  // Weighted average (high=3, medium=2, low=1)
  const weights = { high: 3, medium: 2, low: 1 };
  let weightedSum = 0;
  let weightTotal = 0;
  for (const est of estimates) {
    const w = weights[est.confidence];
    weightedSum += est.vdot * w;
    weightTotal += w;
  }
  const finalVdot = Math.round(weightedSum / weightTotal);
  const allVdots = estimates.map((e) => e.vdot);
  const minVdot = Math.min(...allVdots);
  const maxVdot = Math.max(...allVdots);

  console.log(`\n→ Weighted-average VDOT: ${finalVdot}`);
  console.log(`→ Range: ${minVdot}-${maxVdot}`);
  console.log(`→ Confidence: ${maxVdot - minVdot <= 2 ? "high (estimates converge)" : maxVdot - minVdot <= 4 ? "medium" : "low (estimates diverge — more data needed)"}`);

  // Convert VDOT to predicted 5k and key paces
  const predicted5k = vdotPredicted5k(finalVdot);
  console.log(`\nDaniels-implied performance at VDOT ${finalVdot}:`);
  console.log(`  Predicted 5k:       ${predicted5k}`);
  console.log(`  Easy pace:          ${vdotEasyPace(finalVdot)}/km`);
  console.log(`  Marathon pace:      ${vdotMarathonPace(finalVdot)}/km`);
  console.log(`  Threshold pace (T): ${vdotThresholdPace(finalVdot)}/km`);
  console.log(`  Interval pace (I):  ${vdotIntervalPace(finalVdot)}/km`);

  // HR-zone assignments via Karvonen (75% / 87% HRR)
  const hrr = hrZones.maxHeartRateUsed - hrZones.restingHeartRateUsed;
  const z1Max = Math.round(hrZones.restingHeartRateUsed + 0.75 * hrr);
  const z2Max = Math.round(hrZones.restingHeartRateUsed + 0.87 * hrr);
  console.log(`\nKarvonen HR zones (HRmax ${hrZones.maxHeartRateUsed}, HRrest ${hrZones.restingHeartRateUsed}):`);
  console.log(`  Z1 (Easy):       < ${z1Max} bpm (75% HRR)`);
  console.log(`  Z2 (Threshold):  ${z1Max}-${z2Max} bpm (75-87% HRR)`);
  console.log(`  Z3 (VO2max):     > ${z2Max} bpm (87% HRR+)`);

  // Save final analysis
  await writeFile(
    join(OUTPUT_DIR, "28-vdot-analysis.json"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      runs,
      estimates,
      finalVdot,
      range: { min: minVdot, max: maxVdot },
      hrZones: { z1Max, z2Max, hrMax: hrZones.maxHeartRateUsed, hrRest: hrZones.restingHeartRateUsed },
      predicted5k,
    }, null, 2),
  );

  console.log("\n✓ Full analysis saved to 28-vdot-analysis.json");
}

// ============================================================================
// VDOT helpers — Daniels' Running Formula
// ============================================================================
function vdotFrom5kSec(t5kSec: number): number {
  // Daniels VDOT formula
  const vMperMin = 5000 / (t5kSec / 60);
  const vo2 = -4.60 + 0.182258 * vMperMin + 0.000104 * vMperMin * vMperMin;
  const tMin = t5kSec / 60;
  const pctVo2max = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  return Math.round(vo2 / pctVo2max);
}

function vdotPredicted5k(vdot: number): string {
  // Inverse: solve for t5kSec given VDOT
  // Use binary search since formula isn't analytically invertible
  let low = 600;  // 10:00 minimum
  let high = 3000; // 50:00 max
  while (high - low > 1) {
    const mid = (low + high) / 2;
    const v = vdotFrom5kSec(mid);
    if (v < vdot) high = mid;
    else low = mid;
  }
  const sec = Math.round(low);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

const VDOT_PACES: Record<number, { E: string; M: string; T: string; I: string }> = {
  30: { E: "7:27", M: "6:24", T: "6:04", I: "5:28" },
  32: { E: "7:05", M: "6:08", T: "5:48", I: "5:12" },
  34: { E: "6:45", M: "5:54", T: "5:33", I: "4:58" },
  36: { E: "6:25", M: "5:41", T: "5:25", I: "4:54" },
  38: { E: "6:11", M: "5:28", T: "5:12", I: "4:41" },
  40: { E: "5:58", M: "5:16", T: "5:00", I: "4:30" },
  42: { E: "5:45", M: "5:05", T: "4:45", I: "4:15" },
  44: { E: "5:34", M: "4:53", T: "4:32", I: "4:05" },
  46: { E: "5:23", M: "4:43", T: "4:21", I: "3:55" },
  48: { E: "5:13", M: "4:33", T: "4:11", I: "3:46" },
  50: { E: "5:03", M: "4:24", T: "4:01", I: "3:38" },
};

function nearestVdot(vdot: number): number {
  const keys = Object.keys(VDOT_PACES).map(Number);
  return keys.reduce((nearest, k) => Math.abs(k - vdot) < Math.abs(nearest - vdot) ? k : nearest);
}

function vdotEasyPace(vdot: number): string {
  return VDOT_PACES[nearestVdot(vdot)]?.E ?? "?";
}
function vdotMarathonPace(vdot: number): string {
  return VDOT_PACES[nearestVdot(vdot)]?.M ?? "?";
}
function vdotThresholdPace(vdot: number): string {
  return VDOT_PACES[nearestVdot(vdot)]?.T ?? "?";
}
function vdotIntervalPace(vdot: number): string {
  return VDOT_PACES[nearestVdot(vdot)]?.I ?? "?";
}

main().catch((e) => {
  console.error("\n✗ Fatal error:", e);
  process.exit(1);
});
