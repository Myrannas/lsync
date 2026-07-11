import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const publicPackages = [
  { directory: "packages/definition", name: "@lsync/definitions" },
  { directory: "packages/transport", name: "@lsync/transport" },
  { directory: "packages/server", name: "@lsync/server" },
  { directory: "packages/tanstack-db", name: "@lsync/client" },
] as const;

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const root = resolve(import.meta.dirname, "..");
const arguments_ = process.argv.slice(2).filter((argument) => argument !== "--");
const dryRun = arguments_.includes("--dry-run");
const unknownFlags = arguments_.filter(
  (argument) => argument.startsWith("--") && argument !== "--dry-run",
);
const versions = arguments_.filter((argument) => !argument.startsWith("--"));

if (unknownFlags.length > 0) {
  throw new Error(`Unknown option: ${unknownFlags.join(", ")}`);
}

if (versions.length !== 1 || !semverPattern.test(versions[0]!)) {
  throw new Error("Usage: vp run version:packages -- <semver> [--dry-run]");
}

const nextVersion = versions[0]!;
const updates = publicPackages.map(({ directory, name }) => {
  const path = resolve(root, directory, "package.json");
  const packageJson = JSON.parse(readFileSync(path, "utf8")) as {
    name?: string;
    private?: boolean;
    version?: string;
    [key: string]: unknown;
  };

  if (packageJson.name !== name) {
    throw new Error(`Expected ${path} to describe ${name}, found ${packageJson.name ?? "no name"}`);
  }
  if (packageJson.private === true) {
    throw new Error(`Refusing to version private package ${name}`);
  }
  if (typeof packageJson.version !== "string") {
    throw new Error(`${name} does not have a version`);
  }

  return {
    name,
    nextPackageJson: { ...packageJson, version: nextVersion },
    path,
    previousVersion: packageJson.version,
  };
});

for (const update of updates) {
  const verb = dryRun ? "Would update" : "Updated";
  console.log(`${verb} ${update.name}: ${update.previousVersion} -> ${nextVersion}`);

  if (!dryRun) {
    writeFileSync(update.path, `${JSON.stringify(update.nextPackageJson, null, 2)}\n`);
  }
}
