# Contributing to lsync

Thanks for helping improve `lsync`. The project is experimental, so focused changes with clear
tests and documentation are especially valuable.

## Before you start

- Search the existing issues and pull requests before opening a duplicate.
- For a substantial API or architecture change, open an issue first so the direction can be
  agreed before implementation.
- Keep the shared collection definition as the public contract between server and client code.

## Set up the workspace

`lsync` uses [Vite+](https://viteplus.dev/guide/) for dependency management, formatting, linting,
type checking, builds, and tests.

```sh
git clone https://github.com/Myrannas/lsync.git
cd lsync
vp install
```

If the toolchain or runtime does not behave as expected, run `vp env doctor` and include its output
when asking for help.

## Run the examples

Start the Worker and React application in separate terminals:

```sh
vp run dev:worker
vp run dev:react
```

The Worker listens on `localhost:8787`; the React development server prints its local URL when it
starts.

Run the documentation site locally with `vp run docs:dev`. Use `vp run docs:build` to validate
documentation changes and the generated API reference.

## Make a change

- Add or update tests alongside behavior changes.
- Keep source files below 300 lines; split larger modules around clear responsibilities.
- Prefer source-level fixes over casts, disabled checks, or configuration exceptions.
- Keep wire contracts in `@lsync/transport` and shared collection contracts in
  `@lsync/definitions`.
- Update examples and documentation when a public API or workflow changes.

## Validate your work

Run the repository checks and test suite:

```sh
vp run check
vp test
```

Changes to the Worker, transport, or client/server integration should also run the end-to-end path:

```sh
vp run e2e
```

The check command formats, lints, type checks, and runs the repository's structural checks. Please
resolve failures rather than weakening the checks.

## Open a pull request

Keep pull requests narrow enough to review as one coherent change. Include:

- the problem being solved;
- the approach and any important trade-offs;
- the validation commands you ran; and
- screenshots or recordings when the example UI changes.

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
