# Eager sync

Use eager sync when a collection is small enough to load in full or when most screens need the same
rows.

```ts
import { appCollections } from "./definition";
import { collectionTypesFrom } from "@lsync/client";

export const { settings } = collectionTypesFrom(appCollections)
  .url(syncUrl)
  .collection("settings", (settings) => settings.sync("eager"))
  .build();
```

An eager collection reads the full collection from the server, marks itself ready, and then applies
subscription updates.

```tsx
import { useLiveQuery } from "@tanstack/react-db";

export function SettingsPanel() {
  const { data } = useLiveQuery((query) =>
    query.from({ setting: settings.all() }).orderBy(({ setting }) => setting.id),
  );

  return (
    <dl>
      {data.map((setting) => (
        <div key={setting.id}>
          <dt>{setting.id}</dt>
          <dd>{setting.value}</dd>
        </div>
      ))}
    </dl>
  );
}
```

Use eager sync for bounded collections such as user settings and reference tables. It is capped at
10,000 rows by default; see
[Limits and rate limiting](/examples/limits-and-rate-limiting) to choose a different cap or move a
growing collection to on-demand sync.
