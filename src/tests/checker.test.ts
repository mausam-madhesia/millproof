// Unit tests for the rules engine. Run: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkCertificate, astmEditionYear, FieldResult } from "../checker.js";
import { CertData } from "../fields.js";

function cert(over: Partial<CertData> = {}): CertData {
  const base = {
    supplier: "Test Supplier", mill_name: "Test Mill", heat_number: "H1", standard: "IS 2062:2011", grade: "E250",
    certificate_no: null, cert_date: null, product: null, thickness_mm: 16, elongation_gauge: "proportional",
  };
  return {
    ...base,
    ...over,
    chemistry: { C: 0.18, Mn: 0.82, Si: 0.21, S: 0.024, P: 0.028, CE: 0.33, Cr: 0.03, Ni: 0.02, Cu: 0.03, Mo: 0.01, ...(over.chemistry ?? {}) },
    mechanical: { yield_strength_mpa: 300, tensile_strength_mpa: 450, elongation_pct: 27, ...(over.mechanical ?? {}) },
  } as CertData;
}
const field = (d: CertData, f: string): FieldResult => checkCertificate(d).results.find((r) => r.field === f)!;
const a36 = (over: Partial<CertData> = {}) =>
  cert({ standard: "ASTM A36/A36M-19", grade: "A36", elongation_gauge: "200mm", thickness_mm: 10, chemistry: { C: 0.19, Mn: 0.86, S: 0.017, P: 0.021, Si: 0.2, CE: null }, ...over });

describe("IS 2062 yield bands: <20 mm, 20-40 mm inclusive, >40 mm", () => {
  const cases: [string, number, number][] = [
    ["E250", 19.9, 250], ["E250", 20, 240], ["E250", 40, 240], ["E250", 40.1, 230],
    ["E250BR", 19.9, 250], ["E250BR", 20, 240], ["E250BR", 40, 240], ["E250BR", 40.1, 230],
    ["E350", 19.9, 350], ["E350", 20, 330], ["E350", 40, 330], ["E350", 40.1, 320],
  ];
  for (const [grade, t, min] of cases) {
    test(`${grade} at ${t} mm -> yield min ${min} MPa`, () => {
      const r = field(cert({ grade, thickness_mm: t }), "mechanical.yield_strength_mpa");
      assert.equal(r.min, min);
      assert.match(r.note ?? "", new RegExp(`product is ${t} mm`));
    });
  }
  test("E250 plate exactly 20 mm with YS 245 passes (20-40 band, 240 MPa)", () => {
    assert.equal(field(cert({ thickness_mm: 20, mechanical: { yield_strength_mpa: 245 } }), "mechanical.yield_strength_mpa").status, "pass");
  });
  test("E350 plate exactly 20 mm with YS 335 passes; 19.9 mm with YS 335 fails", () => {
    const g = { grade: "E350", chemistry: { Mn: 1.3, CE: 0.41 }, mechanical: { yield_strength_mpa: 335, tensile_strength_mpa: 500, elongation_pct: 24 } };
    assert.equal(field(cert({ ...g, thickness_mm: 20 }), "mechanical.yield_strength_mpa").status, "pass");
    assert.equal(field(cert({ ...g, thickness_mm: 19.9 }), "mechanical.yield_strength_mpa").status, "fail");
  });
  test("no thickness -> thinnest band, with a note", () => {
    const r = field(cert({ thickness_mm: null }), "mechanical.yield_strength_mpa");
    assert.equal(r.min, 250);
    assert.match(r.note ?? "", /Thickness not given/);
  });
});

describe("ASTM A36 bands stay inclusive ('to 3/4 in [20 mm] incl.')", () => {
  const cases: [number, number, RegExp][] = [
    [19.9, 0.25, /to 3\/4 in \[20 mm\]/], [20, 0.25, /to 3\/4 in \[20 mm\]/], [20.1, 0.25, /20-40 mm/],
    [40, 0.25, /20-40 mm/], [40.1, 0.26, /40-65 mm/],
  ];
  for (const [t, max, src] of cases) {
    test(`A36 carbon at ${t} mm -> max ${max}`, () => {
      const r = field(a36({ thickness_mm: t }), "chemistry.C");
      assert.equal(r.max, max);
      assert.match(r.source ?? "", src);
    });
  }
  test("A36 manganese: no limit at 20 mm, 0.80-1.20 at 20.1 mm", () => {
    assert.equal(field(a36({ thickness_mm: 20 }), "chemistry.Mn").status, "info");
    const r = field(a36({ thickness_mm: 20.1 }), "chemistry.Mn");
    assert.deepEqual([r.min, r.max, r.status], [0.8, 1.2, "pass"]);
  });
});

describe("Elongation gauge must match the spec", () => {
  for (const g of ["50mm", "200mm"] as const) {
    test(`IS 2062 with ${g} gauge -> review, verdict INCOMPLETE`, () => {
      const d = cert({ elongation_gauge: g });
      const r = field(d, "mechanical.elongation_pct");
      assert.equal(r.status, "review");
      assert.match(r.note ?? "", /5\.65√So/);
      const c = checkCertificate(d);
      assert.equal(c.verdict, "INCOMPLETE");
      assert.equal(c.counts.review, 1);
    });
  }
  test("IS 2062 with proportional gauge -> judged normally", () => {
    assert.equal(field(cert({ elongation_gauge: "proportional" }), "mechanical.elongation_pct").status, "pass");
  });
  test("IS 2062 with no gauge stated -> judged on the 5.65√So limit", () => {
    assert.equal(field(cert({ elongation_gauge: null }), "mechanical.elongation_pct").status, "pass");
  });
  test("IS 2062 with wrong gauge but a failing-looking value is review, not fail", () => {
    assert.equal(field(cert({ elongation_gauge: "200mm", mechanical: { elongation_pct: 20 } }), "mechanical.elongation_pct").status, "review");
  });
  test("A36 with 50mm gauge -> 23% limit; with proportional gauge -> review", () => {
    assert.equal(field(a36({ elongation_gauge: "50mm", mechanical: { elongation_pct: 22 } }), "mechanical.elongation_pct").status, "fail");
    assert.equal(field(a36({ elongation_gauge: "proportional" }), "mechanical.elongation_pct").status, "review");
  });
});

describe("Carbon equivalent: judge the higher of reported and calculated when they differ by > 0.02", () => {
  // Calculated CE for these values: 0.20 + 1.20/6 + 0.05/5 + 0.06/15 = 0.414
  const chem = { C: 0.2, Mn: 1.2, Cr: 0.03, Mo: 0.01, V: 0.01, Ni: 0.03, Cu: 0.03 };
  test("reported 0.38 vs calculated 0.414 (E250A max 0.42): judged on 0.414 -> pass, with note", () => {
    const r = field(cert({ chemistry: { ...chem, CE: 0.38 } }), "chemistry.CE");
    assert.equal(r.status, "pass");
    assert.match(r.note ?? "", /higher value \(0\.414\)/);
  });
  test("reported 0.38 vs calculated 0.414 (E250BR max 0.41): judged on 0.414 -> fail", () => {
    assert.equal(field(cert({ grade: "E250BR", chemistry: { ...chem, CE: 0.38 } }), "chemistry.CE").status, "fail");
  });
  test("reported 0.44 vs calculated 0.414: judged on reported 0.44 -> fail", () => {
    const r = field(cert({ chemistry: { ...chem, CE: 0.44 } }), "chemistry.CE");
    assert.equal(r.status, "fail");
    assert.match(r.note ?? "", /higher value \(0\.44\)/);
  });
  test("reported within 0.02 of calculated: judged on reported, no note", () => {
    const r = field(cert({ chemistry: { ...chem, CE: 0.42 } }), "chemistry.CE");
    assert.equal(r.status, "pass");
    assert.equal(r.note, undefined);
  });
  test("CE not printed: judged on calculated", () => {
    const r = field(cert({ grade: "E250BR", chemistry: { ...chem, CE: null } }), "chemistry.CE");
    assert.equal(r.status, "fail");
    assert.match(r.note ?? "", /calculated CE 0\.414/);
  });
  test("mismatch still raises the CE_MISMATCH red flag", () => {
    assert.ok(checkCertificate(cert({ chemistry: { ...chem, CE: 0.38 } })).flags.some((f) => f.code === "CE_MISMATCH"));
  });
});

describe("ASTM A36 P and S limits by edition", () => {
  test("edition parsing", () => {
    assert.equal(astmEditionYear("ASTM A36/A36M-19"), 2019);
    assert.equal(astmEditionYear("ASTM A36/A36M - 14"), 2014);
    assert.equal(astmEditionYear("A36-08"), 2008);
    assert.equal(astmEditionYear("ASTM A 36/A 36M-97a"), 1997);
    assert.equal(astmEditionYear("ASTM A36/A36M-2022"), 2022);
    assert.equal(astmEditionYear("ASTM A36/A36M"), null);
  });
  test("A36-19: P/S max 0.030, source names A36-19", () => {
    const d = a36({ standard: "ASTM A36/A36M-19", chemistry: { S: 0.035, P: 0.035 } });
    for (const f of ["chemistry.P", "chemistry.S"]) {
      const r = field(d, f);
      assert.equal(r.max, 0.03);
      assert.equal(r.status, "fail");
      assert.match(r.source ?? "", /A36\/A36M-19/);
    }
  });
  test("A36-22 (later edition) uses the 2019 limits", () => {
    assert.equal(field(a36({ standard: "ASTM A36/A36M-22" }), "chemistry.S").max, 0.03);
  });
  test("A36-14: P max 0.04, S max 0.05, source names A36-14", () => {
    const d = a36({ standard: "ASTM A36/A36M-14", chemistry: { S: 0.035, P: 0.035 } });
    const p = field(d, "chemistry.P"), s = field(d, "chemistry.S");
    assert.deepEqual([p.max, p.status, s.max, s.status], [0.04, "pass", 0.05, "pass"]);
    assert.match(p.source ?? "", /A36\/A36M-14/);
    assert.match(s.note ?? "", /Edition 2014/);
  });
  test("no edition printed: current A36-19 limits, with a note", () => {
    const r = field(a36({ standard: "ASTM A36/A36M" }), "chemistry.S");
    assert.equal(r.max, 0.03);
    assert.match(r.note ?? "", /No edition printed/);
  });
});

describe("Sample certificate used in the demo", () => {
  test("RK24-3561 (E250BR, 16 mm) passes", () => {
    const d = cert({ grade: "E250BR", chemistry: { V: 0.002, Nb: 0.002, Ti: 0.002 }, mechanical: { yield_strength_mpa: 298, tensile_strength_mpa: 452, elongation_pct: 27 } });
    const c = checkCertificate(d);
    assert.equal(c.verdict, "PASS");
    assert.deepEqual(c.counts, { pass: 9, fail: 0, missing: 0, review: 0 });
  });
});
