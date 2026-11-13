/**
 * Emits cross-engine parity fixtures.
 *
 * The studio scaler and the Python scaler must agree byte-for-byte on the same
 * inputs; backend/tests/test_parity.py asserts against these files.
 *
 *   npm run fixtures
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_FRAMEWORKS } from "../src/lib/samples";
import { scaleFramework } from "../src/lib/scaler";

const target = join(process.cwd(), "..", "backend", "tests", "fixtures");
mkdirSync(target, { recursive: true });

for (const framework of SAMPLE_FRAMEWORKS) {
  const slug = framework.id.replace(/^fw_/, "");
  writeFileSync(join(target, `framework_${slug}.json`), JSON.stringify(framework, null, 2));
  for (const duration of [30, 45]) {
    const plan = scaleFramework(framework, {
      target_duration_sec: duration,
      bg_mode: "framework",
      preserve_sfx: true,
    });
    writeFileSync(join(target, `plan_${slug}_${duration}.json`), JSON.stringify(plan, null, 2));
  }
  console.log(`fixtures · ${framework.framework_name} → 30s / 45s`);
}
