// Compile the existing server modules for the independent same-image worker.
import ts from "typescript";
import { cp, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const root = process.cwd(), source = path.join(root, "src"), destination = path.join(root, ".next", "standalone", "worker");
const seen = new Set();
async function compile(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const text = await readFile(file, "utf8"), dependencies = [];
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText.replace(/require\("(@\/[^\"]+)"\)/g, (_, specifier) => {
    const dependency = path.join(source, specifier.slice(2) + ".ts");
    dependencies.push(dependency);
    const relative = path.relative(path.dirname(file), dependency).replaceAll(path.sep, "/").replace(/\.ts$/, ".js");
    return `require(${JSON.stringify(relative.startsWith(".") ? relative : "./" + relative)})`;
  });
  const target = path.join(destination, path.relative(source, file).replace(/\.ts$/, ".js"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, output);
  await Promise.all(dependencies.map(compile));
}
await compile(path.join(source, "worker", "data-worker.ts"));
// Next bundles Zod into route chunks rather than tracing it as a runtime
// package. The separately compiled worker still requires it. Put this existing,
// self-contained dependency beside the worker, without pnpm symlinks pointing
// back to the build machine. No new application dependency is introduced.
await cp(path.join(root, "node_modules", "zod"), path.join(destination, "node_modules", "zod"), { recursive: true, dereference: true });
