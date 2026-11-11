// The field catalogue: every value a certificate record can hold, in one place.
// Used by the MCP tools, the checker, the editor and the public page.

export const CHEM_ELEMENTS = ["C", "Mn", "Si", "S", "P", "CE", "Cr", "Ni", "Cu", "Mo", "V", "Nb", "Ti"] as const;
export type ChemElement = (typeof CHEM_ELEMENTS)[number];

export const CHEM_LABELS: Record<ChemElement, string> = {
  C: "Carbon (C)",
  Mn: "Manganese (Mn)",
  Si: "Silicon (Si)",
  S: "Sulphur (S)",
  P: "Phosphorus (P)",
  CE: "Carbon equivalent (CE), as reported",
  Cr: "Chromium (Cr)",
  Ni: "Nickel (Ni)",
  Cu: "Copper (Cu)",
  Mo: "Molybdenum (Mo)",
  V: "Vanadium (V)",
  Nb: "Niobium (Nb)",
  Ti: "Titanium (Ti)",
};

export const MECH_FIELDS = ["yield_strength_mpa", "tensile_strength_mpa", "elongation_pct"] as const;
export type MechField = (typeof MECH_FIELDS)[number];

export const MECH_LABELS: Record<MechField, string> = {
  yield_strength_mpa: "Yield strength (MPa)",
  tensile_strength_mpa: "Tensile strength (MPa)",
  elongation_pct: "Elongation (%)",
};

export const GAUGES = ["proportional", "50mm", "200mm"] as const;
export type Gauge = (typeof GAUGES)[number];

export const IDENTITY_FIELDS = [
  "supplier",
  "mill_name",
  "heat_number",
  "standard",
  "grade",
  "certificate_no",
  "cert_date",
  "product",
  "thickness_mm",
  "elongation_gauge",
] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export const IDENTITY_LABELS: Record<IdentityField, string> = {
  supplier: "Supplier",
  mill_name: "Mill",
  heat_number: "Heat number",
  standard: "Standard",
  grade: "Grade",
  certificate_no: "Certificate no.",
  cert_date: "Certificate date",
  product: "Product",
  thickness_mm: "Thickness (mm)",
  elongation_gauge: "Elongation gauge",
};

/** Every editable field path, e.g. "heat_number", "chemistry.S", "mechanical.yield_strength_mpa". */
export const EDITABLE_PATHS = [
  ...IDENTITY_FIELDS,
  ...CHEM_ELEMENTS.map((e) => `chemistry.${e}` as const),
  ...MECH_FIELDS.map((m) => `mechanical.${m}` as const),
] as const;
export type FieldPath = (typeof EDITABLE_PATHS)[number];

export const NUMERIC_IDENTITY = new Set<string>(["thickness_mm"]);
export const REQUIRED_TEXT = new Set<string>(["supplier", "heat_number", "standard", "grade"]);

export interface CertData {
  supplier: string;
  mill_name: string | null;
  heat_number: string;
  standard: string;
  grade: string;
  certificate_no: string | null;
  cert_date: string | null;
  product: string | null;
  thickness_mm: number | null;
  elongation_gauge: Gauge | null;
  chemistry: Partial<Record<ChemElement, number | null>>;
  mechanical: Partial<Record<MechField, number | null>>;
}

export function labelFor(path: string): string {
  if (path.startsWith("chemistry.")) return CHEM_LABELS[path.slice(10) as ChemElement] ?? path;
  if (path.startsWith("mechanical.")) return MECH_LABELS[path.slice(11) as MechField] ?? path;
  if (path === "CE_calc") return "Carbon equivalent (calculated)";
  return IDENTITY_LABELS[path as IdentityField] ?? path;
}

export function getValue(d: CertData, path: string): unknown {
  if (path.startsWith("chemistry.")) return d.chemistry[path.slice(10) as ChemElement] ?? null;
  if (path.startsWith("mechanical.")) return d.mechanical[path.slice(11) as MechField] ?? null;
  return (d as unknown as Record<string, unknown>)[path] ?? null;
}

/** Parse and validate a raw value for a field. Throws Error with a human message on bad input. */
export function parseFieldValue(path: string, raw: unknown): string | number | null {
  if (!(EDITABLE_PATHS as readonly string[]).includes(path)) throw new Error(`Unknown field "${path}".`);
  const isBlank = raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
  const numeric = path.startsWith("chemistry.") || path.startsWith("mechanical.") || NUMERIC_IDENTITY.has(path);

  if (isBlank) {
    if (REQUIRED_TEXT.has(path)) throw new Error(`${labelFor(path)} cannot be empty.`);
    return null;
  }
  if (path === "elongation_gauge") {
    const v = String(raw).trim().toLowerCase().replace(/\s+/g, "");
    if (!(GAUGES as readonly string[]).includes(v)) throw new Error(`Elongation gauge must be one of: ${GAUGES.join(", ")}.`);
    return v;
  }
  if (numeric) {
    const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
    if (!Number.isFinite(n)) throw new Error(`${labelFor(path)} must be a number.`);
    if (path.startsWith("chemistry.") && (n < 0 || n > 100)) throw new Error(`${labelFor(path)} must be a weight % between 0 and 100.`);
    if (path.startsWith("mechanical.") && (n <= 0 || n > 5000)) throw new Error(`${labelFor(path)} looks wrong (${n}).`);
    if (path === "thickness_mm" && (n <= 0 || n > 1000)) throw new Error(`Thickness looks wrong (${n} mm).`);
    return n;
  }
  const s = String(raw).trim();
  if (s.length > 200) throw new Error(`${labelFor(path)} is too long.`);
  return s;
}

export function setValue(d: CertData, path: string, value: string | number | null): void {
  if (path.startsWith("chemistry.")) {
    d.chemistry[path.slice(10) as ChemElement] = value as number | null;
  } else if (path.startsWith("mechanical.")) {
    d.mechanical[path.slice(11) as MechField] = value as number | null;
  } else {
    (d as unknown as Record<string, unknown>)[path] = value;
  }
}
