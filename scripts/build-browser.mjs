import path from "node:path";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { rollup } from "rollup";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = process.cwd();
const outdir = path.join(packageRoot, "dist");
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

for (const [name, format] of [["background", "es"], ["content", "iife"]]) {
  const bundle = await rollup({
    input: path.join(packageRoot, `src/${name}.ts`),
    plugins: [typescriptPlugin()]
  });
  await bundle.write({
    file: path.join(outdir, `${name}.js`),
    format,
    sourcemap: true,
    inlineDynamicImports: true
  });
  await bundle.close();
}
await cp(path.join(packageRoot, "src/manifest.json"), path.join(outdir, "manifest.json"));

function typescriptPlugin() {
  return {
    name: "algo-sync-typescript",
    resolveId(source, importer) {
      if (source === "@algo-sync/shared") return path.join(repoRoot, "packages/shared/src/protocol.ts");
      if (importer?.endsWith(".ts") && source.startsWith(".")) {
        const resolved = path.resolve(path.dirname(importer), source);
        return path.extname(resolved) ? resolved : `${resolved}.ts`;
      }
      return null;
    },
    transform(code, id) {
      if (!id.endsWith(".ts")) return null;
      return {
        code: ts.transpileModule(code, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true }
        }).outputText,
        map: null
      };
    }
  };
}
