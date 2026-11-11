import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface Limit {
  min?: number;
  max?: number;
  source: string;
  verify: boolean;
}
export interface BandLimit extends Partial<Limit> {
  upto_mm?: number;
  source: string;
  verify: boolean;
}
export interface Rule {
  min?: number;
  max?: number;
  source?: string;
  verify?: boolean;
  required?: boolean;
  bands?: BandLimit[];
  by_gauge?: Record<string, Limit>;
  default_gauge?: string;
}
export interface Spec {
  id: string;
  label: string;
  standard: string;
  note?: string;
  match: { standard: string; grade: string };
  chemistry: Record<string, Rule>;
  mechanical: Record<string, Rule>;
}
interface SpecFile {
  _edition_warning?: string;
  specs: Spec[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.resolve(here, "..", "spec", "specs.json");
const file: SpecFile = JSON.parse(readFileSync(specPath, "utf8"));

export const SPECS: Spec[] = file.specs;
export const EDITION_WARNING = file._edition_warning ?? "";

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Find the spec for a standard + grade as written on a certificate. Returns null if unsupported. */
export function resolveSpec(standard: string | null | undefined, grade: string | null | undefined): Spec | null {
  const std = norm(standard);
  // Claude sometimes puts the standard inside the grade ("IS 2062 E250BR"); strip it.
  const gr = norm(grade).replace(/^IS2062(\d{4})?/, "").replace(/^(ASTM|ASME)/, "");
  for (const spec of SPECS) {
    if (!std.includes(spec.match.standard) && !norm(grade).includes(spec.match.standard)) continue;
    if (new RegExp(spec.match.grade).test(gr)) return spec;
  }
  return null;
}

export function supportedGradesText(): string {
  return SPECS.map((s) => `${s.label} [${s.standard}]`).join("; ");
}
