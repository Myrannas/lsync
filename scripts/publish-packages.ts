import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageDirectories = [
  "packages/definition",
  "packages/transport",
  "packages/server",
  "packages/tanstack-db",
] as const;

const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const tagIndex = process.argv.indexOf("--tag");
const tag = tagIndex === -1 ? "latest" : process.argv[tagIndex + 1];

if (!tag) {
  throw new Error("--tag requires an npm distribution tag");
}

function run(command: string, arguments_: Array<string>, cwd: string) {
  const result = spawnSync(command, arguments_, { cwd, stdio: "inherit" });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  }
}

function capture(command: string, arguments_: Array<string>, cwd: string) {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

function alreadyPublished(name: string, version: string) {
  const result = capture("npm", ["view", `${name}@${version}`, "version", "--json"], root);

  if (result.status === 0) return true;
  if (`${result.stderr}`.includes("E404")) return false;

  throw new Error(`Could not query ${name}@${version}:\n${result.stderr}`);
}

const packDirectory = mkdtempSync(join(tmpdir(), "lsync-packages-"));
process.env.npm_config_cache = join(packDirectory, "npm-cache");

try {
  for (const packageDirectory of packageDirectories) {
    const cwd = resolve(root, packageDirectory);
    const packageJson = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      name: string;
      version: string;
    };

    if (packageJson.version === "0.0.0" && !dryRun) {
      throw new Error(`${packageJson.name} still has the placeholder version 0.0.0`);
    }

    if (!dryRun && alreadyPublished(packageJson.name, packageJson.version)) {
      console.log(`Skipping ${packageJson.name}@${packageJson.version}; it is already published.`);
      continue;
    }

    const packed = capture(
      "corepack",
      ["pnpm", "pack", "--json", "--pack-destination", packDirectory],
      cwd,
    );

    if (packed.status !== 0) {
      throw new Error(`Could not pack ${packageJson.name}:\n${packed.stderr}`);
    }

    const { filename } = JSON.parse(packed.stdout) as { filename: string };
    const publishArguments = ["publish", filename, "--access", "public", "--tag", tag];
    if (dryRun) publishArguments.push("--dry-run", "--offline");

    run("npm", publishArguments, root);
  }
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
}
