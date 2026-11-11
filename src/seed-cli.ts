// npm run seed            -> load samples only if the database is empty
// npm run seed -- --reset -> wipe everything and reload the samples
import { countCertificates, resetAll } from "./repo.js";
import { seed } from "./seed.js";

const reset = process.argv.includes("--reset");
if (reset) await resetAll();
if (reset || (await countCertificates()) === 0) {
  await seed();
  console.log("Loaded 6 sample certificates.");
} else {
  console.log("Database already has certificates. Use `npm run seed -- --reset` to wipe and reload.");
}
process.exit(0);
