const PREFIX = "[rmk-tools:convert]";

export type ConvertLogExtra = Record<string, string | number | boolean | null | undefined>;

/** Structured logs for the convert pipeline (server terminal). */
export function convertLog(
  subsystem: "api" | "vision" | "pdf" | "claude" | "excel",
  event: string,
  extra?: ConvertLogExtra,
): void {
  const line = {
    ts: new Date().toISOString(),
    subsystem,
    event,
    ...extra,
  };
  console.log(`${PREFIX} ${JSON.stringify(line)}`);
}

export function convertLogError(
  subsystem: string,
  err: unknown,
  extra?: ConvertLogExtra,
): void {
  const e = err instanceof Error ? err : new Error(String(err));
  const line = {
    ts: new Date().toISOString(),
    subsystem,
    event: "error",
    name: e.name,
    message: e.message,
    stack: e.stack,
    ...extra,
  };
  console.error(`${PREFIX} ${JSON.stringify(line)}`);
}
