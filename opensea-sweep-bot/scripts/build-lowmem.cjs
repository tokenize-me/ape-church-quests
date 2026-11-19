/**
 * Low-memory build for the droplet: transpiles each src/**\/*.ts file on its own with TypeScript's transpileModule
 * (no whole-program type check, so it never loads viem / twitter-api-v2 types). Output layout, compiler options and
 * source maps match `tsc` (checked byte-identical 2026-11-19). Type checking still runs locally / in CI with
 * `npm run typecheck`; `npm run build` on a 512 MB-1 GB droplet was being OOM-killed ("Killed"), leaving a stale dist.
 *
 * Usage: node scripts/build-lowmem.cjs [outDir]
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'tsconfig.json');
const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
const options = parsed.options;
const rootDir = options.rootDir;
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : options.outDir;

let count = 0;
for (const file of parsed.fileNames) {
  if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
  const rel = path.relative(rootDir, file);
  const jsPath = path.join(outDir, rel.replace(/\.ts$/, '.js'));
  const source = fs.readFileSync(file, 'utf8');
  const out = ts.transpileModule(source, { compilerOptions: options, fileName: file, reportDiagnostics: true });
  const errors = (out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    for (const d of errors) console.error(`${rel}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(jsPath), { recursive: true });
  // Point the source map comment / sources at the same paths tsc writes.
  let js = out.outputText;
  let map = out.sourceMapText;
  if (options.sourceMap && map) {
    const mapObj = JSON.parse(map);
    mapObj.file = path.basename(jsPath);
    mapObj.sources = [path.relative(path.dirname(jsPath), file).split(path.sep).join('/')];
    fs.writeFileSync(`${jsPath}.map`, JSON.stringify(mapObj));
  }
  fs.writeFileSync(jsPath, js);
  count++;
}
console.log(`Transpiled ${count} files to ${path.relative(root, outDir) || '.'}`);
