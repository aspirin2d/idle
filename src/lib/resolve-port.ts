const DEFAULT_PORT = 3000;

export function resolvePort(value: string | undefined | null): number {
  if (value == null) {
    return DEFAULT_PORT;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return DEFAULT_PORT;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? DEFAULT_PORT : parsed;
}

export { DEFAULT_PORT };
