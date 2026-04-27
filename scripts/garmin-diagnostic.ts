// scripts/garmin-diagnostic.ts
//
// Discovery script — fetches every endpoint that Garmin Connect publicly exposes
// and writes the raw JSON to ./garmin-diagnostic-output/ for inspection.
//
// Usage:
//   npx tsx scripts/garmin-diagnostic.ts
//
// What this does:
// 1. Logs in via your existing GARMIN_USERNAME/GARMIN_PASSWORD from .env.local
// 2. Calls every endpoint we suspect might be useful for performance metrics
// 3. Writes each response as a separate JSON file under garmin-diagnostic-output/
// 4. Prints a SUMMARY at the end showing which endpoints returned data
//
// All errors are caught per-endpoint so one failure doesn't stop the script.
// Read-only — never mutates Garmin data.

import { config as dotenvConfig } from "dotenv";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

dotenvConfig({ path: ".env.local" });

const OUTPUT_DIR = "./garmin-diagnostic-output";
const GC_API = "https://connectapi.garmin.com";

interface Result {
  endpoint: string;
  description: string;
  status: "OK" | "EMPTY" | "ERROR";
  bytes: number;
  errorMessage?: string;
  hasInterestingFields?: string[];
}

const results: Result[] = [];

async function saveResult(
  endpoint: string,
  description: string,
  fileName: string,
  fetchFn: () => Promise<unknown>,
  interestingFields: string[] = [],
): Promise<void> {
  console.log(`\n→ ${description}`);
  console.log(`  endpoint: ${endpoint}`);

  try {
    const data = await fetchFn();
    const json = JSON.stringify(data, null, 2);
    await writeFile(join(OUTPUT_DIR, `${fileName}.json`), json, "utf-8");

    const bytes = Buffer.byteLength(json, "utf-8");
    const found = interestingFields.filter((field) => {
      const path = field.split(".");
      let cur: unknown = data;
      for (const p of path) {
        if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[p];
        } else {
          return false;
        }
      }
      return cur !== null && cur !== undefined;
    });

    const status: Result["status"] = bytes < 50 ? "EMPTY" : "OK";
    results.push({
      endpoint,
      description,
      status,
      bytes,
      hasInterestingFields: found.length > 0 ? found : undefined,
    });

    console.log(`  ✓ ${status} (${bytes} bytes)${found.length > 0 ? `, found: ${found.join(", ")}` : ""}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    results.push({ endpoint, description, status: "ERROR", bytes: 0, errorMessage: msg });
    console.log(`  ✗ ERROR: ${msg.slice(0, 200)}`);
  }
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Dynamic import of garmin-connect lib
  const garminLib = await import("garmin-connect");
  // The lib export shape varies — find the GarminConnect class
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const GarminConnect = (garminLib as any).GarminConnect ?? (garminLib as any).default?.GarminConnect ?? (garminLib as any).default;

  if (!GarminConnect) {
    throw new Error("Could not find GarminConnect export in garmin-connect package");
  }

  const username = process.env.GARMIN_USERNAME;
  const password = process.env.GARMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("GARMIN_USERNAME and GARMIN_PASSWORD must be set in .env.local");
  }

  console.log(`\nGarmin Connect Diagnostic`);
  console.log(`==========================`);
  console.log(`User: ${username}`);
  console.log(`Output dir: ${OUTPUT_DIR}\n`);
  console.log("Logging in...");

  const gc = new GarminConnect({ username, password });
  await gc.login();
  console.log("✓ Logged in\n");

  // The lib's authenticated http client. Field name might be `client` or `_client`
  // depending on lib version — try common shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawClient: { get: <T>(url: string) => Promise<T> } =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gc as any).client ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gc as any)._client ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gc as any).http;

  if (!rawClient || typeof rawClient.get !== "function") {
    throw new Error("Could not access authenticated http client on GarminConnect instance. Check lib version.");
  }

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const yesterdayKey = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);

  // ==========================================================================
  // 1. User Profile Basics
  // ==========================================================================
  console.log("\n─── USER PROFILE ───");

  await saveResult(
    "userprofile-service/userprofile/personal-information",
    "Personal info (DOB, weight, height, gender)",
    "01-personal-information",
    () => rawClient.get(`${GC_API}/userprofile-service/userprofile/personal-information`),
    ["userInfo.birthDate", "userInfo.weight", "userInfo.height", "biometricProfile.weight"],
  );

  await saveResult(
    "userprofile-service/userprofile/user-settings",
    "User settings (units, activity level)",
    "02-user-settings",
    () => rawClient.get(`${GC_API}/userprofile-service/userprofile/user-settings`),
    [],
  );

  // ==========================================================================
  // 2. Heart Rate Zones (CRITICAL)
  // ==========================================================================
  console.log("\n─── HEART RATE ZONES ───");

  await saveResult(
    "biometric-service/heartRateZones",
    "HR zones (max HR, lactate threshold HR)",
    "03-heart-rate-zones",
    () => rawClient.get(`${GC_API}/biometric-service/heartRateZones`),
    ["maxHeartRate", "restingHeartRate", "lactateThresholdHeartRate"],
  );

  await saveResult(
    "userprofile-service/userprofile/heartRateZones",
    "HR zones (alternative endpoint)",
    "04-heart-rate-zones-alt",
    () => rawClient.get(`${GC_API}/userprofile-service/userprofile/heartRateZones`),
    ["maxHeartRate", "restingHeartRate", "lactateThresholdHeartRate"],
  );

  // ==========================================================================
  // 3. Performance Metrics (VO2max, Threshold, Race Predictions)
  // ==========================================================================
  console.log("\n─── PERFORMANCE METRICS ───");

  await saveResult(
    "metrics-service/metrics/maxmet/latest/RUNNING",
    "VO2max RUNNING (latest)",
    "05-vo2max-running",
    () => rawClient.get(`${GC_API}/metrics-service/metrics/maxmet/latest/RUNNING`),
    ["generic.vo2MaxValue", "generic.vo2MaxPreciseValue"],
  );

  await saveResult(
    "metrics-service/metrics/maxmet/latest/CYCLING",
    "VO2max CYCLING (latest, often empty)",
    "06-vo2max-cycling",
    () => rawClient.get(`${GC_API}/metrics-service/metrics/maxmet/latest/CYCLING`),
    [],
  );

  await saveResult(
    "metrics-service/metrics/maxmet/RUNNING",
    "VO2max RUNNING history",
    "07-vo2max-running-history",
    () => rawClient.get(`${GC_API}/metrics-service/metrics/maxmet/RUNNING`),
    [],
  );

  await saveResult(
    "metrics-service/metrics/racepredictions/latest",
    "Race time predictions (5k/10k/HM/M)",
    "08-race-predictions",
    () => rawClient.get(`${GC_API}/metrics-service/metrics/racepredictions/latest`),
    ["raceTime5K", "raceTime10K", "raceTimeHalf", "raceTimeMarathon"],
  );

  await saveResult(
    "metrics-service/metrics/racepredictions",
    "Race predictions history",
    "09-race-predictions-history",
    () => rawClient.get(`${GC_API}/metrics-service/metrics/racepredictions`),
    [],
  );

  await saveResult(
    "biometric-service/lactateThreshold",
    "Lactate threshold (Garmin auto-detected)",
    "10-lactate-threshold",
    () => rawClient.get(`${GC_API}/biometric-service/lactateThreshold`),
    ["lactateThresholdHeartRate", "lactateThresholdSpeed"],
  );

  // ==========================================================================
  // 4. Training Status / Load / Readiness
  // ==========================================================================
  console.log("\n─── TRAINING STATUS ───");

  await saveResult(
    "metrics-service/metrics/trainingstatus/aggregated",
    "Training status (productive / maintaining / detraining)",
    "11-training-status",
    () => rawClient.get(`${GC_API}/metrics-service/metrics/trainingstatus/aggregated/${todayKey}`),
    [],
  );

  await saveResult(
    "metrics-service/metrics/trainingreadiness",
    "Training readiness (today)",
    "12-training-readiness",
    () => rawClient.get(`${GC_API}/metrics-service/metrics/trainingreadiness/${todayKey}`),
    ["score", "level", "feedbackLong"],
  );

  await saveResult(
    "metrics-service/metrics/trainingload/acute-chronic",
    "Acute / chronic training load (Garmin's ACWR)",
    "13-training-load-acwr",
    () => rawClient.get(`${GC_API}/metrics-service/metrics/trainingload/acute-chronic/${todayKey}`),
    [],
  );

  await saveResult(
    "fitnessstats-service/activity",
    "Fitness stats activity summary",
    "14-fitness-stats",
    () => rawClient.get(`${GC_API}/fitnessstats-service/activity`),
    [],
  );

  // ==========================================================================
  // 5. HRV
  // ==========================================================================
  console.log("\n─── HRV ───");

  await saveResult(
    "hrv-service/hrv/<date>",
    "HRV (today)",
    "15-hrv-today",
    () => rawClient.get(`${GC_API}/hrv-service/hrv/${todayKey}`),
    ["hrvSummary.lastNightAvg", "hrvSummary.status", "hrvSummary.weeklyAvg"],
  );

  await saveResult(
    "hrv-service/hrv/<yesterday>",
    "HRV (yesterday — fallback)",
    "16-hrv-yesterday",
    () => rawClient.get(`${GC_API}/hrv-service/hrv/${yesterdayKey}`),
    ["hrvSummary.lastNightAvg"],
  );

  // ==========================================================================
  // 6. Recent Activities + Activity Detail
  // ==========================================================================
  console.log("\n─── ACTIVITIES ───");

  await saveResult(
    "activitylist-service/activities/search/activities",
    "Last 10 activities (summary)",
    "17-recent-activities",
    () => rawClient.get(`${GC_API}/activitylist-service/activities/search/activities?start=0&limit=10`),
    [],
  );

  // Get most recent activity ID to fetch detailed metrics
  let lastActivityId: number | null = null;
  try {
    const recent = await rawClient.get<Array<{ activityId: number; activityType?: { typeKey?: string } }>>(
      `${GC_API}/activitylist-service/activities/search/activities?start=0&limit=10`,
    );
    const lastRun = recent.find((a) => a.activityType?.typeKey?.includes("running"));
    lastActivityId = lastRun?.activityId ?? recent[0]?.activityId ?? null;
  } catch {
    /* ignore */
  }

  if (lastActivityId) {
    console.log(`\n  → Using activity ID ${lastActivityId} for detail endpoints\n`);

    await saveResult(
      `activity-service/activity/<id>`,
      "Activity detail (summary + splits)",
      "18-activity-detail",
      () => rawClient.get(`${GC_API}/activity-service/activity/${lastActivityId}`),
      ["activityId", "averageHR", "maxHR", "vO2MaxValue", "lactateThresholdBpm", "lactateThresholdSpeed"],
    );

    await saveResult(
      `activity-service/activity/<id>/hrTimeInZones`,
      "HR time in 5 zones for this activity",
      "19-activity-hr-zones",
      () => rawClient.get(`${GC_API}/activity-service/activity/${lastActivityId}/hrTimeInZones`),
      [],
    );

    await saveResult(
      `activity-service/activity/<id>/splits`,
      "Splits (km-by-km) for this activity",
      "20-activity-splits",
      () => rawClient.get(`${GC_API}/activity-service/activity/${lastActivityId}/splits`),
      [],
    );

    await saveResult(
      `activity-service/activity/<id>/details`,
      "Time-series (sec-by-sec) data — large!",
      "21-activity-timeseries",
      () => rawClient.get(`${GC_API}/activity-service/activity/${lastActivityId}/details?maxChartSize=1000&maxPolylineSize=1000`),
      [],
    );

    await saveResult(
      `activity-service/activity/<id>/typedsplits`,
      "Typed splits (lap/intervals)",
      "22-activity-typedsplits",
      () => rawClient.get(`${GC_API}/activity-service/activity/${lastActivityId}/typedsplits`),
      [],
    );
  } else {
    console.log("\n  ⚠ No recent activity found — skipping activity-detail endpoints");
  }

  // ==========================================================================
  // 7. Sleep Detail
  // ==========================================================================
  console.log("\n─── SLEEP ───");

  await saveResult(
    "wellness-service/wellness/dailySleepData",
    "Sleep detail (today)",
    "23-sleep-today",
    () => rawClient.get(`${GC_API}/wellness-service/wellness/dailySleepData/${username}?date=${todayKey}`),
    ["dailySleepDTO.sleepScores.overall.value"],
  );

  // ==========================================================================
  // 8. Body Battery / Stress
  // ==========================================================================
  console.log("\n─── BODY BATTERY / STRESS ───");

  let displayName = "";
  try {
    const profile = await gc.getUserProfile();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    displayName = (profile as any)?.displayName ?? "";
  } catch {
    /* ignore */
  }

  if (displayName) {
    await saveResult(
      "usersummary-service/usersummary/daily/<displayName>",
      "Daily user summary (body battery, stress, calories)",
      "24-daily-summary",
      () => rawClient.get(`${GC_API}/usersummary-service/usersummary/daily/${displayName}?calendarDate=${todayKey}`),
      ["bodyBatteryAtWakeTime", "bodyBatteryMostRecentValue", "averageStressLevel"],
    );
  }

  // ==========================================================================
  // 9. Goals
  // ==========================================================================
  console.log("\n─── GOALS ───");

  await saveResult(
    "goal-service/goal/goals",
    "Garmin Goals (5k goal, training goals)",
    "25-goals",
    () => rawClient.get(`${GC_API}/goal-service/goal/goals`),
    [],
  );

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log("\n\n══════════════════════════════════════════════════════════════");
  console.log("                          SUMMARY");
  console.log("══════════════════════════════════════════════════════════════\n");

  const ok = results.filter((r) => r.status === "OK");
  const empty = results.filter((r) => r.status === "EMPTY");
  const errors = results.filter((r) => r.status === "ERROR");

  console.log(`✓ ${ok.length} endpoints returned data`);
  console.log(`◌ ${empty.length} endpoints returned empty/null`);
  console.log(`✗ ${errors.length} endpoints failed\n`);

  console.log("─── ENDPOINTS WITH USEFUL DATA ───");
  for (const r of ok) {
    const flag = r.hasInterestingFields ? " ★" : "";
    console.log(`  ✓ ${r.description} (${r.bytes} bytes)${flag}`);
    if (r.hasInterestingFields) {
      console.log(`     → contains: ${r.hasInterestingFields.join(", ")}`);
    }
  }

  if (empty.length > 0) {
    console.log("\n─── EMPTY ───");
    for (const r of empty) console.log(`  ◌ ${r.description}`);
  }

  if (errors.length > 0) {
    console.log("\n─── FAILED ───");
    for (const r of errors) {
      console.log(`  ✗ ${r.description}`);
      console.log(`     → ${r.errorMessage?.slice(0, 150)}`);
    }
  }

  await writeFile(
    join(OUTPUT_DIR, "00-SUMMARY.json"),
    JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
    "utf-8",
  );

  console.log(`\n✓ All raw responses saved to ${OUTPUT_DIR}/`);
  console.log(`✓ Summary saved to ${OUTPUT_DIR}/00-SUMMARY.json\n`);
}

main().catch((e) => {
  console.error("\n✗ Fatal error:", e);
  process.exit(1);
});
