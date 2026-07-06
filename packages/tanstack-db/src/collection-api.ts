import { collectionPathSegments, isCollectionPathParam } from "./collection-path";

export function defaultCollectionApiPath(path: string, name: string): string {
  const prefix = collectionPathSegments(path)
    .filter((segment) => !isCollectionPathParam(segment))
    .join(".");

  return prefix ? `${prefix}.${name}` : name;
}
