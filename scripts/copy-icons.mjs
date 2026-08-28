// Build helper: copy node icons next to the compiled node file.
// Build-time only; never shipped as runtime code.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const nodeDir of ["Postdom", "PostdomTrigger"]) {
  const outDir = join(root, "dist", "nodes", nodeDir);
  mkdirSync(outDir, { recursive: true });
  for (const icon of ["postdom.svg", "postdom.dark.svg"]) {
    copyFileSync(join(root, "nodes", nodeDir, icon), join(outDir, icon));
  }
}
