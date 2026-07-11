# Publishing to npm

The public packages are:

- `@lsync/definitions`
- `@lsync/transport`
- `@lsync/server`
- `@lsync/client`

The example and integration-test workspaces are private and are never published.

## npm setup

1. Create or confirm the `lsync` organization at npmjs.com.
2. Ensure your npm account can publish public packages in that organization.
3. Update all public package versions together with `vp run version:packages -- 0.0.2`, replacing
   `0.0.2` with the intended release. Add `--dry-run` to preview the changes. `0.0.0` is a protected
   placeholder and the publish script will reject it.
4. Run `vp run publish:packages:dry-run` and inspect the package contents.
5. For the first release, either authenticate locally and run `vp run publish:packages`, or add a
   granular automation token as the `NPM_TOKEN` GitHub repository secret and dispatch the publish
   workflow.

pnpm creates each tarball so workspace dependencies are converted from `workspace:*` to concrete
package versions. npm publishes those tarballs so local publishing and trusted publishing use the
same artifacts.

## Trusted publishing

After the first version of each package exists on npm, configure its trusted publisher with:

- Provider: GitHub Actions
- GitHub organization or user: `Myrannas`
- Repository: `lsync`
- Workflow: `publish.yml`
- Allowed action: publish

The workflow can then be run manually from GitHub Actions without a long-lived npm token. It uses
npm's OIDC authentication and automatically receives provenance when the repository and packages
are public. Remove the `NPM_TOKEN` repository secret once trusted publishing works for all four
packages.

Before dispatching the workflow, commit the intended package versions and lockfile. The workflow
runs the full checks, builds all public packages, skips versions already present on npm, and
publishes the remaining packages in dependency order.
