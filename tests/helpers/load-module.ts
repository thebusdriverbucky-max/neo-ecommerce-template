import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(__dirname, "../..");
const nativeRequire = createRequire(path.join(root, "package.json"));

// Execute actual TS/TSX modules, substituting only explicit boundaries. No env loading,
// Next server, provider SDK initialization or database connection is permitted.
export function moduleLoader(mocks: Record<string, unknown>) {
  const cache = new Map<string, { exports: any }>();
  function load(relative: string): any {
    let filename = path.resolve(root, relative);
    if (!existsSync(filename)) filename += existsSync(filename + ".ts") ? ".ts" : ".tsx";
    if (cache.has(filename)) return cache.get(filename)!.exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const requireMock = (id: string): unknown => {
      if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
      if (/^(?:(?:@\/lib\/|\.\/)(?:db|auth|email|stripe|redis)$|@prisma\/client$|@auth\/|@upstash\/|resend$|next-auth|next-cloudinary|stripe$)/.test(id)) {
        throw new Error(`Unmocked external boundary: ${id}`);
      }
      if (id.startsWith("@/")) return load(id.slice(2));
      if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), id));
      return nativeRequire(id);
    };
    new Function("require", "module", "exports", source)(requireMock, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load;
}
