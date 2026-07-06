import type { ManagedProcess } from "./processes";

export interface WaitOptions {
  timeoutMs: number;
  intervalMs?: number;
}

export async function waitForHttpOk(url: string, options: WaitOptions): Promise<string> {
  return waitFor(
    async () => {
      const response = await fetchWithTimeout(url, options.intervalMs ?? 1_000);
      if (!response.ok) {
        throw new Error(`Expected HTTP 2xx from ${url}, received ${response.status}`);
      }
      return response.text();
    },
    `HTTP readiness timed out for ${url}`,
    options,
  );
}

export async function waitForHttpStatus(
  url: string,
  status: number,
  options: WaitOptions,
): Promise<void> {
  await waitFor(
    async () => {
      const response = await fetchWithTimeout(url, options.intervalMs ?? 1_000);
      if (response.status !== status) {
        throw new Error(`Expected HTTP ${status} from ${url}, received ${response.status}`);
      }
    },
    `HTTP readiness timed out for ${url}`,
    options,
  );
}

export function processOutput(processes: Array<ManagedProcess>): string {
  return processes
    .map((process) => process.output())
    .filter((output) => output.length > 0)
    .join("\n");
}

export async function waitFor<T>(
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

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
