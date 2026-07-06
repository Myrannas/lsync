export type CollectionScopeParams = Record<string, string | number>;

export function collectionScope(path: string, params: CollectionScopeParams): string {
  const segments = collectionPathSegments(path).map((segment) => segmentValue(segment, params));
  return `/${segments.map(normalizeSegment).join("/")}/`;
}

export function firstNewPathParam(
  childPath: string | undefined,
  parentPath: string,
): string | undefined {
  if (!childPath) return undefined;

  const parentParams = new Set(pathParams(parentPath));
  return pathParams(childPath).find((param) => !parentParams.has(param));
}

export function collectionPathSegments(path: string): Array<string> {
  return path
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
}

export function collectionPathParamName(segment: string): string | undefined {
  return (
    segment.match(/^\{([A-Za-z_][A-Za-z0-9_]*)\}$/)?.[1] ??
    segment.match(/^:([A-Za-z_][A-Za-z0-9_]*)$/)?.[1]
  );
}

export function isCollectionPathParam(segment: string): boolean {
  return collectionPathParamName(segment) !== undefined;
}

function segmentValue(segment: string, params: CollectionScopeParams): string {
  const param = collectionPathParamName(segment);
  if (!param) return segment;

  const value = params[param];
  if (value === undefined) {
    throw new Error(`Missing collection path parameter: ${param}`);
  }

  return String(value);
}

function pathParams(path: string): Array<string> {
  return collectionPathSegments(path).flatMap((segment) => {
    const param = collectionPathParamName(segment);
    return param ? [param] : [];
  });
}

function normalizeSegment(segment: string): string {
  return encodeURIComponent(decodeURIComponent(segment));
}
