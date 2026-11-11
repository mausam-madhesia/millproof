// The rules engine. Plain arithmetic against the spec table. No AI, no guessing.
// Same input always gives the same output.

import { CertData, CHEM_ELEMENTS, MECH_FIELDS, labelFor } from "./fields.js";
import { Rule, Spec, resolveSpec } from "./specs.js";

/** review = a value is present but cannot be judged against this limit (e.g. elongation on a different gauge length). */
export type FieldStatus = "pass" | "fail" | "missing" | "review" | "info";
export type Verdict = "PASS" | "FAIL" | "INCOMPLETE";

export interface FieldResult {
  field: string; // "chemistry.C", "mechanical.yield_strength_mpa", "CE_calc"
  label: string;
  value: number | null;
  status: FieldStatus;
  min: number | null;
  max: number | null;
  limitText: string;
  source: string | null;
  verify: boolean;
  note?: string;
}
export interface Flag {
  code: string;
  message: string;
}
export interface CheckResult {
  specId: string;
  specLabel: string;
  standard: string;
  verdict: Verdict;
  counts: { pass: number; fail: number; missing: number; review: number };
  results: FieldResult[];
  flags: Flag[];
  checkedAt: string;
}

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

/** CE = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15 (IIW formula, as used in IS 2062). Null if C or Mn missing. */
export function calcCE(d: CertData): number | null {
  const c = d.chemistry;
  if (c.C == null || c.Mn == null) return null;
  const z = (v: number | null | undefined) => v ?? 0;
  return round(c.C + c.Mn / 6 + (z(c.Cr) + z(c.Mo) + z(c.V)) / 5 + (z(c.Ni) + z(c.Cu)) / 15, 3);
}

function fmtLimit(min: number | null, max: number | null, unit: string): string {
  if (min != null && max != null) return `${min}–${max}${unit}`;
  if (min != null) return `≥ ${min}${unit}`;
  if (max != null) return `≤ ${max}${unit}`;
  return "No limit";
}

/** ASTM edition from the standard as printed, e.g. "ASTM A36/A36M-19" -> 2019. Null if no edition is printed. */
export function astmEditionYear(standard: string | null | undefined): number | null {
  const m = (standard ?? "").toUpperCase().replace(/\s+/g, "").match(/A36(?:\/A36M)?[-–](\d{2,4})/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[1].length === 4 ? n : n < 50 ? 2000 + n : 1900 + n;
}

interface Effective { min: number | null; max: number | null; source: string | null; verify: boolean; note?: string; review?: string }

/** Pick the concrete limit that applies (by thickness band, edition or gauge). */
export function effectiveLimit(rule: Rule, d: CertData): Effective {
  if (rule.bands) {
    const t = d.thickness_mm;
    let band = rule.bands[0];
    let note: string | undefined;
    if (t == null) {
      note = "Thickness not given, so the thinnest-product band was used.";
    } else {
      // below_mm: thickness < value (exclusive). upto_mm: thickness <= value (inclusive). Neither: catch-all.
      band =
        rule.bands.find((b) => (b.below_mm != null ? t < b.below_mm : b.upto_mm != null ? t <= b.upto_mm : true)) ??
        rule.bands[rule.bands.length - 1];
      const i = rule.bands.indexOf(band);
      const prev = i > 0 ? rule.bands[i - 1] : null;
      const lowerVal = prev ? (prev.below_mm ?? prev.upto_mm) : null;
      const lowerTxt = prev == null ? "" : prev.below_mm != null ? `${lowerVal} mm (incl.)` : `over ${lowerVal} mm`;
      const upperTxt = band.below_mm != null ? `below ${band.below_mm} mm` : band.upto_mm != null ? `up to ${band.upto_mm} mm (incl.)` : "";
      const range = prev == null ? upperTxt : upperTxt ? `${lowerTxt} to ${upperTxt.replace("up to ", "")}` : lowerTxt.startsWith("over") ? lowerTxt : `${lowerVal} mm and over`;
      note = `Thickness band: ${range}; product is ${t} mm.`;
    }
    return { min: band.min ?? null, max: band.max ?? null, source: band.source, verify: band.verify, note };
  }
  if (rule.by_edition) {
    const year = astmEditionYear(d.standard);
    const key = year == null || year >= 2019 ? "2019+" : "pre-2019";
    const lim = rule.by_edition[key];
    const note = year == null ? "No edition printed on the certificate, so the current A36-19 limit was used." : `Edition ${year} printed on the certificate.`;
    return { min: lim.min ?? null, max: lim.max ?? null, source: lim.source, verify: lim.verify, note };
  }
  if (rule.by_gauge) {
    const g = d.elongation_gauge;
    if (g && !rule.by_gauge[g]) {
      const lim = rule.by_gauge[rule.default_gauge!];
      return { min: lim.min ?? null, max: lim.max ?? null, source: lim.source, verify: lim.verify, review: `Certificate reports elongation on a ${g === "proportional" ? "5.65√So" : g} gauge; the spec gives limits only for ${Object.keys(rule.by_gauge).join(" and ")} gauges. Check manually or ask the mill for a result on the right gauge.` };
    }
    const use = g ?? rule.default_gauge!;
    const lim = rule.by_gauge[use];
    const note = g ? `Gauge length ${use}.` : `Gauge not given, so ${use} was assumed.`;
    return { min: lim.min ?? null, max: lim.max ?? null, source: lim.source, verify: lim.verify, note };
  }
  const base: Effective = { min: rule.min ?? null, max: rule.max ?? null, source: rule.source ?? null, verify: !!rule.verify };
  if (rule.gauge && d.elongation_gauge && d.elongation_gauge !== rule.gauge) {
    base.review = `Certificate reports elongation on a ${d.elongation_gauge} gauge, but this limit is for the 5.65√So proportional gauge. The two are not comparable; check manually or ask the mill for a proportional-gauge result.`;
  }
  return base;
}

const within = (v: number, min: number | null, max: number | null) => (min == null || v >= min) && (max == null || v <= max);

function evaluate(field: string, value: number | null, rule: Rule | undefined, d: CertData, unit: string): FieldResult {
  const label = labelFor(field);
  if (!rule) {
    return { field, label, value, status: "info", min: null, max: null, limitText: "No limit in spec", source: null, verify: false };
  }
  const lim = effectiveLimit(rule, d);
  const base = { field, label, value, min: lim.min, max: lim.max, limitText: fmtLimit(lim.min, lim.max, unit), source: lim.source, verify: lim.verify, note: lim.note };
  if (lim.min == null && lim.max == null) return { ...base, status: "info" };
  if (value == null) return { ...base, status: rule.required === false ? "info" : "missing" };
  if (lim.review) return { ...base, status: "review", note: lim.review };
  return { ...base, status: within(value, lim.min, lim.max) ? "pass" : "fail" };
}

export function checkCertificate(d: CertData, duplicates: { id: string; sameChemistry: boolean }[] = []): CheckResult {
  const spec: Spec | null = resolveSpec(d.standard, d.grade);
  if (!spec) throw new Error(`No spec for standard "${d.standard}" grade "${d.grade}".`);

  const results: FieldResult[] = [];
  const ceCalc = calcCE(d);

  for (const el of CHEM_ELEMENTS) {
    const rule = spec.chemistry[el];
    const value = d.chemistry[el] ?? null;
    if (el === "CE" && rule) {
      // Reported CE is judged as printed, unless it disagrees with the CE calculated from the chemistry
      // by more than 0.02: then the higher of the two is judged. If CE is not printed, the calculated CE is judged.
      const r = evaluate("chemistry.CE", value ?? ceCalc, rule, d, "");
      r.value = value;
      if (r.status === "pass" || r.status === "fail" || r.status === "missing") {
        if (value == null && ceCalc != null) {
          r.status = within(ceCalc, r.min, r.max) ? "pass" : "fail";
          r.note = `Not printed on the certificate; judged on the calculated CE ${ceCalc.toFixed(3)}.`;
        } else if (value != null && ceCalc != null && Math.abs(value - ceCalc) > 0.02) {
          const judged = Math.max(value, ceCalc);
          r.status = within(judged, r.min, r.max) ? "pass" : "fail";
          r.note = `Reported ${value} and calculated ${ceCalc.toFixed(3)} differ by more than 0.02, so the higher value (${judged === value ? value : judged.toFixed(3)}) was judged.`;
        }
      }
      results.push(r);
      continue;
    }
    results.push(evaluate(`chemistry.${el}`, value, rule, d, ""));
  }
  if (spec.chemistry.CE) {
    results.push({
      field: "CE_calc",
      label: labelFor("CE_calc"),
      value: ceCalc,
      status: "info",
      min: null,
      max: null,
      limitText: "C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15",
      source: "Calculated by MillProof from the reported chemistry. Unreported alloying elements counted as 0.",
      verify: false,
    });
  }
  for (const m of MECH_FIELDS) {
    const unit = m === "elongation_pct" ? "%" : " MPa";
    results.push(evaluate(`mechanical.${m}`, d.mechanical[m] ?? null, spec.mechanical[m], d, unit));
  }

  // Red flags: things that suggest a copied, edited or mistyped certificate. They do not change the verdict.
  const flags: Flag[] = [];
  const ys = d.mechanical.yield_strength_mpa, uts = d.mechanical.tensile_strength_mpa;
  if (ys != null && uts != null && ys >= uts) {
    flags.push({ code: "YS_GE_UTS", message: `Yield strength (${ys}) is not below tensile strength (${uts}). That is physically implausible for structural steel; check for a typo or an altered certificate.` });
  }
  const ceRep = d.chemistry.CE;
  if (ceRep != null && ceCalc != null && Math.abs(ceRep - ceCalc) > 0.02) {
    flags.push({ code: "CE_MISMATCH", message: `Reported CE ${ceRep} differs from CE calculated from the printed chemistry (${ceCalc.toFixed(3)}) by more than 0.02. Ask the mill how CE was computed.` });
  }
  for (const dup of duplicates) {
    flags.push({
      code: "DUP_HEAT",
      message: dup.sameChemistry
        ? `Heat number already recorded on certificate ${dup.id} with identical chemistry (a repeat delivery from the same heat, or a reused certificate).`
        : `Heat number already recorded on certificate ${dup.id} with DIFFERENT chemistry. One heat has one chemistry, so one of the two certificates is wrong.`,
    });
  }

  const counts = { pass: 0, fail: 0, missing: 0, review: 0 };
  for (const r of results) {
    if (r.status === "pass") counts.pass++;
    else if (r.status === "fail") counts.fail++;
    else if (r.status === "missing") counts.missing++;
    else if (r.status === "review") counts.review++;
  }
  // A value that needs manual review blocks PASS just like a missing one.
  const verdict: Verdict = counts.fail > 0 ? "FAIL" : counts.missing + counts.review > 0 ? "INCOMPLETE" : "PASS";

  return { specId: spec.id, specLabel: spec.label, standard: spec.standard, verdict, counts, results, flags, checkedAt: new Date().toISOString() };
}
