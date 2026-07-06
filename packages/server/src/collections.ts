import type { CollectionConfig, CollectionConfigs } from "./types";

export interface ResolvedCollection {
  name: string;
  collection: CollectionConfig;
  params: Record<string, string>;
  scope: string;
}

interface PatternMatch {
  name: string;
  collection: CollectionConfig;
  params: Record<string, string>;
  staticSegments: number;
  segments: number;
  index: number;
}

export function resolveCollection(
  collectionName: string,
  collections: CollectionConfigs = {},
): ResolvedCollection | undefined {
  const exact = collections[collectionName];

  if (exact) {
    return {
      name: collectionName,
      collection: exact,
      params: {},
      scope: collectionScope(collectionName),
    };
  }

  const matches = Object.entries(collections).flatMap(([name, collection], index) => {
    const match = matchCollectionPattern(name, collectionName);

    return match
      ? [
          {
            name,
            collection,
            params: match.params,
            staticSegments: match.staticSegments,
            segments: match.segments,
            index,
          },
        ]
      : [];
  });

  const best = matches.sort(comparePatternMatches)[0];
  if (!best) {
    return undefined;
  }

  return {
    name: best.name,
    collection: best.collection,
    params: best.params,
    scope: collectionScope(collectionName),
  };
}

export function collectionScope(collectionName: string): string {
  const segments = splitCollectionPath(collectionName);
  return `/${segments.map(normalizeSegment).join("/")}/`;
}

export function isCollectionPattern(collectionName: string): boolean {
  return collectionName.split("/").some((segment) => /^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(segment));
}

function matchCollectionPattern(
  pattern: string,
  collectionName: string,
): Omit<PatternMatch, "name" | "collection" | "index"> | undefined {
  if (!isCollectionPattern(pattern)) {
    return undefined;
  }

  const patternSegments = splitCollectionPath(pattern);
  const collectionSegments = splitCollectionPath(collectionName);

  if (patternSegments.length !== collectionSegments.length) {
    return undefined;
  }

  const params: Record<string, string> = {};
  let staticSegments = 0;

  for (const [index, segment] of patternSegments.entries()) {
    const param = segment.match(/^\{([A-Za-z_][A-Za-z0-9_]*)\}$/);

    if (param?.[1]) {
      params[param[1]] = decodeURIComponent(collectionSegments[index] ?? "");
      continue;
    }

    if (segment !== collectionSegments[index]) {
      return undefined;
    }

    staticSegments += 1;
  }

  return {
    params,
    staticSegments,
    segments: patternSegments.length,
  };
}

function comparePatternMatches(left: PatternMatch, right: PatternMatch): number {
  return (
    right.staticSegments - left.staticSegments ||
    right.segments - left.segments ||
    left.index - right.index
  );
}

function splitCollectionPath(path: string): Array<string> {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");

  if (!trimmed) {
    return [];
  }

  return trimmed.split("/");
}

function normalizeSegment(segment: string): string {
  return encodeURIComponent(decodeURIComponent(segment));
}
