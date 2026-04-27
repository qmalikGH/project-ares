import { describe, it, expect } from "vitest";
import {
  classifyHrZone,
  computeHrTID,
  computeHrZones,
  mapGarminZonesToPolarizedTID,
} from "@/lib/coach-engine/hr-zones";

describe("computeHrZones", () => {
  it("computes Q's zones correctly: HRmax 200, HRrest 52", () => {
    const zones = computeHrZones({ hrMax: 200, hrRest: 52 });
    // HRR = 148; Z1 max = 52 + 0.75*148 = 163; Z2 max = 52 + 0.87*148 = 180.76 → 181
    expect(zones.z1Max).toBe(163);
    expect(zones.z2Max).toBe(181);
    expect(zones.hrMax).toBe(200);
    expect(zones.hrRest).toBe(52);
  });

  it("rejects HRmax too low (<120)", () => {
    expect(() => computeHrZones({ hrMax: 100, hrRest: 50 })).toThrow();
  });

  it("rejects HRmax too high (>220)", () => {
    expect(() => computeHrZones({ hrMax: 230, hrRest: 50 })).toThrow();
  });

  it("rejects HRrest too high (>90)", () => {
    expect(() => computeHrZones({ hrMax: 180, hrRest: 100 })).toThrow();
  });

  it("rejects spread too small (<30)", () => {
    expect(() => computeHrZones({ hrMax: 150, hrRest: 130 })).toThrow();
  });
});

describe("classifyHrZone", () => {
  const zones = computeHrZones({ hrMax: 200, hrRest: 52 });

  it("classifies easy run HR 140 as Z1", () => {
    expect(classifyHrZone(140, zones)).toBe(1);
  });

  it("classifies threshold HR 170 as Z2", () => {
    expect(classifyHrZone(170, zones)).toBe(2);
  });

  it("classifies max HR 190 as Z3", () => {
    expect(classifyHrZone(190, zones)).toBe(3);
  });

  it("returns null for missing HR", () => {
    expect(classifyHrZone(null, zones)).toBeNull();
  });

  it("boundary: 163 (z1Max) belongs to Z1 (inclusive)", () => {
    expect(classifyHrZone(163, zones)).toBe(1);
  });

  it("boundary: 164 (z1Max+1) belongs to Z2", () => {
    expect(classifyHrZone(164, zones)).toBe(2);
  });

  it("boundary: 181 (z2Max) belongs to Z2 (inclusive)", () => {
    expect(classifyHrZone(181, zones)).toBe(2);
  });

  it("boundary: 182 (z2Max+1) belongs to Z3", () => {
    expect(classifyHrZone(182, zones)).toBe(3);
  });
});

describe("computeHrTID", () => {
  const zones = computeHrZones({ hrMax: 200, hrRest: 52 });

  it("computes TID from splits across all 3 zones", () => {
    const splits = [
      { durationSec: 600, averageHr: 140 }, // Z1, 10min
      { durationSec: 600, averageHr: 170 }, // Z2, 10min
      { durationSec: 300, averageHr: 190 }, // Z3, 5min
    ];
    const tid = computeHrTID(splits, zones);
    expect(tid.z1Sec).toBe(600);
    expect(tid.z2Sec).toBe(600);
    expect(tid.z3Sec).toBe(300);
    expect(tid.z1Pct).toBeCloseTo(40, 1);
    expect(tid.z2Pct).toBeCloseTo(40, 1);
    expect(tid.z3Pct).toBeCloseTo(20, 1);
    expect(tid.unclassifiedSec).toBe(0);
    expect(tid.totalSec).toBe(1500);
  });

  it("preserves unclassified time when split has no HR", () => {
    const splits = [
      { durationSec: 600, averageHr: 140 }, // Z1
      { durationSec: 300, averageHr: null }, // missing HR
    ];
    const tid = computeHrTID(splits, zones);
    expect(tid.z1Sec).toBe(600);
    expect(tid.unclassifiedSec).toBe(300);
    // Pct is computed against classified total (600), so Z1 = 100%
    expect(tid.z1Pct).toBeCloseTo(100, 1);
    expect(tid.totalSec).toBe(900);
  });

  it("returns 0% across all zones when no HR data at all", () => {
    const splits = [{ durationSec: 600, averageHr: null }];
    const tid = computeHrTID(splits, zones);
    expect(tid.z1Pct).toBe(0);
    expect(tid.z2Pct).toBe(0);
    expect(tid.z3Pct).toBe(0);
    expect(tid.unclassifiedSec).toBe(600);
  });

  it("polarized 80/15/5 distribution computes correctly", () => {
    const splits = [
      { durationSec: 4800, averageHr: 140 }, // 80min Z1
      { durationSec: 900, averageHr: 170 }, // 15min Z2
      { durationSec: 300, averageHr: 190 }, // 5min Z3
    ];
    const tid = computeHrTID(splits, zones);
    expect(tid.z1Pct).toBeCloseTo(80, 1);
    expect(tid.z2Pct).toBeCloseTo(15, 1);
    expect(tid.z3Pct).toBeCloseTo(5, 1);
  });

  it("Mitteltempo-Falle: too much Z2 surfaces as warning signal", () => {
    // 50% Z2 → polarized methodology says this is unhealthy distribution
    const splits = [
      { durationSec: 1800, averageHr: 145 }, // 30min Z1
      { durationSec: 1800, averageHr: 170 }, // 30min Z2 (mitteltempo)
    ];
    const tid = computeHrTID(splits, zones);
    expect(tid.z2Pct).toBeCloseTo(50, 1);
    // Caller can flag this as Z2 > 25% threshold violation
  });
});

describe("mapGarminZonesToPolarizedTID (Sprint v0.7)", () => {
  it("collapses Garmin's 5 zones to polarized 3 (Z1+Z2 → Z1, Z3+Z4 → Z2, Z5 → Z3)", () => {
    const tid = mapGarminZonesToPolarizedTID({
      zone1Sec: 100,
      zone2Sec: 200, // → polar Z1: 300
      zone3Sec: 50,
      zone4Sec: 150, // → polar Z2: 200
      zone5Sec: 100, // → polar Z3: 100
    });
    expect(tid.z1Sec).toBe(300);
    expect(tid.z2Sec).toBe(200);
    expect(tid.z3Sec).toBe(100);
    expect(tid.totalSec).toBe(600);
    expect(tid.z1Pct).toBeCloseTo(50, 1);
    expect(tid.z2Pct).toBeCloseTo(33.33, 1);
    expect(tid.z3Pct).toBeCloseTo(16.67, 1);
  });

  it("Q's real Berlin Run example (19-activity-hr-zones.json)", () => {
    // Garmin: Z1=0, Z2=24s, Z3=311s, Z4=23s, Z5=0
    const tid = mapGarminZonesToPolarizedTID({
      zone1Sec: 0,
      zone2Sec: 24,
      zone3Sec: 311,
      zone4Sec: 23,
      zone5Sec: 0,
    });
    expect(tid.z1Sec).toBe(24);
    expect(tid.z2Sec).toBe(334);
    expect(tid.z3Sec).toBe(0);
    // 24 / 358 ≈ 6.7% Z1 (this run was almost entirely "moderate" — Mitteltempo)
    expect(tid.z1Pct).toBeCloseTo(6.7, 0);
    expect(tid.z2Pct).toBeCloseTo(93.3, 0);
    expect(tid.z3Pct).toBe(0);
  });

  it("returns 0% for an empty session", () => {
    const tid = mapGarminZonesToPolarizedTID({
      zone1Sec: 0,
      zone2Sec: 0,
      zone3Sec: 0,
      zone4Sec: 0,
      zone5Sec: 0,
    });
    expect(tid.z1Pct).toBe(0);
    expect(tid.z2Pct).toBe(0);
    expect(tid.z3Pct).toBe(0);
    expect(tid.totalSec).toBe(0);
  });
});
