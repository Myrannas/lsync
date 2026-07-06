import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface ManagedProcess {
  readonly name: string;
  readonly output: () => string;
  stop(): Promise<void>;
}

export interface StartProcessOptions {
  name: string;
  command: string;
  args: Array<string>;
  cwd: string;
  env?: Record<string, string | undefined>;
}

export function startManagedProcess(options: StartProcessOptions): ManagedProcess {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";

  child.stdout.on("data", (chunk) => {
    output += prefixLines(options.name, String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    output += prefixLines(options.name, String(chunk));
  });

  child.once("error", (error) => {
    output += `[${options.name}] ${error.message}\n`;
  });

  return {
    name: options.name,
    output: () => output.trimEnd(),
    stop: () => stopChild(child),
  };
}

async function stopChild(child: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([onceExit(child), delay(2_000)]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await onceExit(child);
  }
}

function onceExit(child: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefixLines(name: string, text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `[${name}] ${line}\n`)
    .join("");
}
