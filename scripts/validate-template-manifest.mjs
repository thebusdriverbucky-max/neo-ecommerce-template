import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, "template.manifest.json"), "utf8"),
);
const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);

function fail(message) {
  throw new Error(`Template manifest validation failed: ${message}`);
}

if (manifest.schemaVersion !== "1.0.0") fail("unsupported schemaVersion");
if (!manifest.template?.id || !manifest.template?.verifiedAt)
  fail("template metadata is incomplete");
if (!Array.isArray(manifest.environment)) fail("environment must be an array");
if (manifest.runtime?.node !== packageJson.engines?.node)
  fail("Node contract differs from package.json");
if (manifest.runtime?.packageManager !== packageJson.packageManager) {
  fail("package-manager contract differs from package.json");
}
if (manifest.build?.command !== "npm run build")
  fail("build command must be npm run build");

const release = manifest.template.release;
if (
  release?.status === "candidate" &&
  (release.tag !== null || release.commit !== null)
) {
  fail("candidate releases must not claim a tag or commit");
}
if (release?.status === "released" && (!release.tag || !release.commit)) {
  fail("released manifests must pin both tag and commit");
}

const requiredEntryFields = [
  "name",
  "required",
  "feature",
  "secret",
  "scope",
  "valueGroup",
  "description",
  "providerDocsUrl",
  "validation",
  "defaultAvailable",
];
const manifestNames = new Set();
for (const entry of manifest.environment) {
  for (const field of requiredEntryFields) {
    if (!(field in entry))
      fail(`${entry.name || "unnamed ENV"} is missing ${field}`);
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(entry.name))
    fail(`invalid ENV name ${entry.name}`);
  if (manifestNames.has(entry.name)) fail(`duplicate ENV entry ${entry.name}`);
  if (!new Set(["server", "client"]).has(entry.scope))
    fail(`invalid scope for ${entry.name}`);
  manifestNames.add(entry.name);
}

const envExampleNames = new Set();
for (const line of readFileSync(join(root, ".env.example"), "utf8").split(
  /\r?\n/,
)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
  if (match) envExampleNames.add(match[1]);
}
for (const name of manifestNames) {
  if (!envExampleNames.has(name)) fail(`${name} is missing from .env.example`);
}
for (const name of envExampleNames) {
  if (!manifestNames.has(name))
    fail(`${name} exists in .env.example but not in the manifest`);
}

const ignoredDirectories = new Set([".git", ".next", "node_modules"]);
const sourceExtensions = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx"]);
const directRuntimeNames = new Set();

function scanDirectory(directory) {
  for (const name of readdirSync(directory)) {
    if (ignoredDirectories.has(name)) continue;
    const path = join(directory, name);
    const relativePath = relative(root, path);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      scanDirectory(path);
      continue;
    }
    if (relativePath === "scripts/validate-template-manifest.mjs") continue;
    if (
      !sourceExtensions.has(extname(name)) ||
      /\.test\.[cm]?[jt]sx?$/.test(name)
    )
      continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (match[1] !== "NODE_ENV") directRuntimeNames.add(match[1]);
    }
  }
}

scanDirectory(root);

const nonDeploymentGuards = new Set(["ALLOW_DEMO_RESET"]);
for (const name of directRuntimeNames) {
  if (!manifestNames.has(name) && !nonDeploymentGuards.has(name)) {
    fail(`runtime ENV ${name} is missing from the manifest`);
  }
}
if (manifest.build?.destructiveReset?.guard !== "ALLOW_DEMO_RESET=true") {
  fail("destructive reset guard is missing from the build contract");
}

console.log(
  `Template manifest is valid (${manifestNames.size} deployment variables).`,
);
