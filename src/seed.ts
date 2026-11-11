// Six sample certificates across three suppliers: a mix of pass, fail and missing values.
// All company names are fictitious.

import { createCertificate, decide } from "./repo.js";
import { config } from "./config.js";

const SAMPLES: { input: Record<string, unknown>; created: string; decision?: { d: "approved" | "rejected"; note: string; at: string } }[] = [
  {
    created: "2026-10-14T10:12:00+05:30",
    input: {
      supplier: "Vardhan Steel Traders", mill_name: "Ravikiran Rolling Mills (fictitious)", heat_number: "RK24-3318",
      standard: "IS 2062:2011", grade: "E250BR", certificate_no: "RRM/TC/26-27/03912", cert_date: "2026-10-09",
      product: "HR plate 12 x 2000 x 6300 mm", thickness_mm: 12, elongation_gauge: "proportional",
      chemistry: { C: 0.17, Mn: 0.78, Si: 0.19, S: 0.021, P: 0.026, CE: 0.31, Cr: 0.02, Ni: 0.01, Cu: 0.02, Mo: 0.005, V: 0.002, Nb: 0.002, Ti: 0.002 },
      mechanical: { yield_strength_mpa: 296, tensile_strength_mpa: 448, elongation_pct: 28 },
    },
    decision: { d: "approved", note: "Matches bundle tags. 14 plates received at Bay 2.", at: "2026-10-14T11:05:00+05:30" },
  },
  {
    created: "2026-10-22T16:40:00+05:30",
    input: {
      supplier: "Konark Metal Corporation", mill_name: "Tapti Valley Steels (fictitious)", heat_number: "TV-50812",
      standard: "IS 2062:2011", grade: "E250", certificate_no: "TVS/QA/8812", cert_date: "2026-10-18",
      product: "HR plate 25 x 1500 x 6000 mm", thickness_mm: 25, elongation_gauge: "proportional",
      chemistry: { C: 0.21, Mn: 0.92, Si: 0.22, S: 0.052, P: 0.038, CE: 0.38, Cr: 0.04, Ni: 0.03, Cu: 0.05, Mo: 0.01, V: 0.002 },
      mechanical: { yield_strength_mpa: 262, tensile_strength_mpa: 438, elongation_pct: 25 },
    },
    decision: { d: "rejected", note: "Sulphur 0.052 is above the 0.045 limit. Supplier informed; material quarantined.", at: "2026-10-23T09:30:00+05:30" },
  },
  {
    created: "2026-10-29T12:05:00+05:30",
    input: {
      supplier: "Sahyog Structural Supplies", mill_name: "Eastbank Ispat (fictitious)", heat_number: "EB-7790",
      standard: "IS 2062:2011", grade: "E250A", certificate_no: "EBI-26-1407", cert_date: "2026-10-25",
      product: "HR sheet 8 x 1250 x 2500 mm", thickness_mm: 8, elongation_gauge: "proportional",
      chemistry: { C: 0.16, Mn: 0.72, Si: 0.17, S: 0.024, P: 0.029, CE: 0.29, Cr: 0.02, Ni: 0.01, Cu: 0.02 },
      mechanical: { yield_strength_mpa: 285, tensile_strength_mpa: 432, elongation_pct: 29 },
    },
    decision: { d: "approved", note: "OK for base plates, project P-118.", at: "2026-10-29T15:20:00+05:30" },
  },
  {
    created: "2026-11-03T14:22:00+05:30",
    input: {
      supplier: "Konark Metal Corporation", mill_name: "Tapti Valley Steels (fictitious)", heat_number: "TV-51177",
      standard: "IS 2062:2011", grade: "E350BR", certificate_no: "TVS/QA/9046", cert_date: "2026-10-31",
      product: "HR plate 16 x 2000 x 6300 mm", thickness_mm: 16, elongation_gauge: "proportional",
      chemistry: { C: 0.19, Mn: 1.45, Si: 0.31, S: 0.029, P: 0.033, CE: 0.42, Cr: 0.05, Ni: 0.03, Cu: 0.06, Mo: 0.01, V: 0.004, Nb: 0.018 },
      mechanical: { yield_strength_mpa: 338, tensile_strength_mpa: 506, elongation_pct: 23 },
    },
  },
  {
    created: "2026-11-06T11:48:00+05:30",
    input: {
      supplier: "Sahyog Structural Supplies", mill_name: "Eastbank Ispat (fictitious)", heat_number: "EB-7741",
      standard: "ASTM A36/A36M-19", grade: "A36", certificate_no: "EBI-26-1388", cert_date: "2026-11-02",
      product: "Plate 10 x 1500 x 6000 mm", thickness_mm: 10, elongation_gauge: "200mm",
      chemistry: { C: 0.19, Mn: 0.86, Si: null, S: 0.017, P: 0.021, Cu: 0.03 },
      mechanical: { yield_strength_mpa: 281, tensile_strength_mpa: 447, elongation_pct: null },
    },
  },
  {
    created: "2026-11-09T17:15:00+05:30",
    input: {
      supplier: "Vardhan Steel Traders", mill_name: "Ravikiran Rolling Mills (fictitious)", heat_number: "RK24-3407",
      standard: "IS 2062:2011", grade: "E350", certificate_no: "RRM/TC/26-27/04107", cert_date: "2026-11-05",
      product: "HR plate 20 x 2500 x 10000 mm", thickness_mm: 20, elongation_gauge: "proportional",
      chemistry: { C: 0.18, Mn: 1.32, Si: 0.28, S: 0.018, P: 0.024, CE: 0.41, Cr: 0.03, Ni: 0.02, Cu: 0.03, Mo: 0.01, V: 0.003, Nb: 0.021, Ti: 0.015 },
      mechanical: { yield_strength_mpa: 372, tensile_strength_mpa: 528, elongation_pct: 24 },
    },
  },
];

export async function seed(): Promise<void> {
  for (const s of SAMPLES) {
    const createdAt = new Date(s.created).toISOString();
    const c = await createCertificate(s.input, "seed", "Sample data", { createdAt });
    if (s.decision) await decide(c.id, s.decision.d, config.demoName, s.decision.note, { at: new Date(s.decision.at).toISOString() });
  }
}
