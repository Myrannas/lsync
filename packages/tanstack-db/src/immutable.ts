export function cloneImmutable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneImmutable));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        cloneImmutable(nestedValue),
      ]),
    ),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
