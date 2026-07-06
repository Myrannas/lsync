import { cloneImmutable } from "./immutable";
import type { CollectionApiMethod, CollectionTypeApi } from "./collection-type-types";

export type BuilderState = Record<string, unknown> & {
  api?: CollectionTypeApi<any, any>;
  name?: string;
  path?: string;
};

export function freezeBuilderState(state: BuilderState): Readonly<BuilderState> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(state)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, copyBuilderStateValue(key, value)]),
    ) as BuilderState,
  );
}

function copyBuilderStateValue(key: string, value: unknown): unknown {
  if (key === "api" && isApiMap(value)) {
    return freezeApiMap(value);
  }

  if (key === "url" && value instanceof URL) {
    return value.toString();
  }

  return cloneImmutable(value);
}

function freezeApiMap(api: CollectionTypeApi<any, any>): CollectionTypeApi<any, any> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(api).map(([name, method]) => [name, freezeApiMethod(method)]),
    ),
  );
}

function freezeApiMethod<
  TInput,
  TOutput,
  T extends object = any,
  TKey extends string | number = any,
>(
  method: CollectionApiMethod<TInput, TOutput, T, TKey>,
): CollectionApiMethod<TInput, TOutput, T, TKey> {
  return Object.freeze({ ...method });
}

function isApiMap(value: unknown): value is CollectionTypeApi<any, any> {
  return typeof value === "object" && value !== null;
}
