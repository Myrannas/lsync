import type { ManagedProcess } from "./processes";

export interface WaitOptions {
  timeoutMs: number;
  intervalMs?: number;
}

export async function waitForHttpOk(url: string, options: WaitOptions): Promise<string> {
  return waitFor(
    async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Expected HTTP 2xx from ${url}, received ${response.status}`);
      }
      return response.text();
    },
    `HTTP readiness timed out for ${url}`,
    options,
  );
}

export async function waitForWebSocket(url: string, options: WaitOptions): Promise<void> {
  await waitFor(
    () =>
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.addEventListener("open", () => {
          ws.close();
          resolve();
        });
        ws.addEventListener("error", () => reject(new Error(`Unable to open ${url}`)));
      }),
    `WebSocket readiness timed out for ${url}`,
    options,
  );
}

export function processOutput(processes: Array<ManagedProcess>): string {
  return processes
    .map((process) => process.output())
    .filter((output) => output.length > 0)
    .join("\n");
}

async function waitFor<T>(
  attempt: () => Promise<T>,
  timeoutMessage: string,
  options: WaitOptions,
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      await delay(options.intervalMs ?? 250);
    }
  }

  const reason = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`${timeoutMessage}${reason}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
