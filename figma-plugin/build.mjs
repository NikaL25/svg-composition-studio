import { build, context } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const ui = await readFile("src/ui.html", "utf8");
const options = { entryPoints: ["src/code.ts"], bundle: true, outfile: "dist/code.js", format: "iife", target: "es2020", sourcemap: true, legalComments: "none" };
if (process.argv.includes("--watch")) {
  const watcher = await context(options);
  await watcher.watch();
  await writeFile("dist/ui.html", ui);
  console.log("Plugin build watching");
} else {
  await build(options);
  await writeFile("dist/ui.html", ui);
  console.log("Plugin build complete");
}
