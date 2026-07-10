# Eager Sync

Use eager sync when a collection is small enough to hydrate in full or when most screens need the
same rows.

```ts
import { appCollections } from "./definition";
import { collectionTypesFrom } from "lsync-tanstack-db";

export const { settings } = collectionTypesFrom(appCollections)
  .url(syncUrl)
  .collection("settings", (settings) => settings.sync("eager"))
  .build();
```

An eager collection performs an initial server read for the full collection, marks itself ready,
and then applies subscription updates.

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

Use eager sync deliberately for low-cardinality collections such as user settings and reference
tables.
