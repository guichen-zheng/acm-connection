import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { rollup } from "rollup";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(repoRoot, "dist"), { recursive: true });
const bundle = await rollup({
  input: path.resolve(process.cwd(), "src/extension.ts"),
  external: (id) => id === "vscode" || id.startsWith("node:"),
  plugins: [typescriptPlugin(), nodeResolve({ preferBuiltins: true, extensions: [".ts", ".js", ".json"] }), commonjs()]
});
await bundle.write({
  file: path.resolve(process.cwd(), "dist/extension.cjs"),
  format: "cjs",
  sourcemap: true,
  exports: "named"
});
await bundle.close();

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
