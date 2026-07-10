/// <reference types="node" />

import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const docsRoot = fileURLToPath(new URL("../docs/.vitepress/dist/", import.meta.url));

const requiredFiles = [
  "api/reference/index.html",
  "api/reference/generated/index.html",
  "api/reference/generated/modules/_lsync_definitions.html",
  "api/reference/generated/modules/_lsync_server.html",
  "api/reference/generated/modules/_lsync_server_client.html",
  "api/reference/generated/modules/_lsync_client.html",
  "api/reference/generated/modules/_lsync_transport.html",
  "api/reference/generated/functions/_lsync_definitions.defineCollections.html",
  "api/reference/generated/classes/_lsync_server.CollectionShardDurableObject.html",
  "api/reference/generated/functions/_lsync_server.createWorkerHandler.html",
  "api/reference/generated/functions/_lsync_client.collectionTypesFrom.html",
  "api/reference/generated/variables/_lsync_transport.apiCallSchema.html",
];

await Promise.all(requiredFiles.map((path) => access(`${docsRoot}${path}`)));

const landingPage = await readFile(`${docsRoot}api/reference/index.html`, "utf8");
const requiredLandingLinks = [
  "_lsync_definitions.html",
  "_lsync_server.html",
  "_lsync_server_client.html",
  "_lsync_client.html",
  "_lsync_transport.html",
];

for (const link of requiredLandingLinks) {
  if (!landingPage.includes(link)) {
    throw new Error(`Generated API landing page is missing ${link}`);
  }
}

const nativeReferenceLinks = landingPage.match(/target="_self"/g)?.length ?? 0;
if (nativeReferenceLinks !== 11) {
  throw new Error(`Expected 11 native API reference links, found ${nativeReferenceLinks}`);
}

console.log(`Verified ${requiredFiles.length} API reference files and all package links.`);
