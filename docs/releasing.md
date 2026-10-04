# Releasing

A tag `vX.Y.Z` runs [.github/workflows/release.yml](../.github/workflows/release.yml):

1. **version** — every package carries the tag's version (four `pyproject.toml`, `tauri.conf.json`, `Cargo.toml`, and
   the `alpine-code-core==` pin in `apps/cli`). Bump them together.
2. **pypi-core**, then **pypi** — publish `alpine-code-core` and `alpine-code` (the CLI) with trusted publishing.
3. **draft** — creates a draft GitHub release for the tag.
4. **macos** — for Apple silicon: builds the Python runtime (`apps/desktop/scripts/bundle_runtime.py`),
   signs every binary in it, builds the app with `tauri.release.conf.json`, notarizes it, and uploads the `.dmg`, the
   updater archive and `latest.json` to the draft.

A pull request that changes the build runs only the macOS job, so signing and notarization are proven before a
tag is pushed: a tag cannot be retried with the same version on PyPI.

Publishing the draft ships the app. Installed apps read
`releases/latest/download/latest.json` at launch, download a newer version quietly and install it when they quit
(`apps/desktop/src-tauri/src/update.rs`).

## How the app runs its server

A released app carries `Contents/Resources/runtime/`: a standalone CPython 3.14 (python-build-standalone, through
uv) with the server and its locked dependencies installed, and a `uv` binary for the toolbox. The shell starts
`runtime/python/bin/python3.14 -I -B -m alpine_server` with `PATH` taken from the user's login shell, so the agent
finds Homebrew, nvm and the rest. Development (`pnpm desktop`) still runs the server from source through uv.

A real interpreter, not a frozen binary, because user tools install packages with `uv pip install --python
sys.executable` and import any standard library module.

## Build locally

```sh
uv run python apps/desktop/scripts/bundle_runtime.py        # APPLE_SIGNING_IDENTITY=... to sign
cd apps/desktop && pnpm tauri build --config src-tauri/tauri.release.conf.json \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Without notarization credentials the app is signed but not notarized; `spctl -a -vv` says "Unnotarized Developer ID".

## One-time setup

**GitHub secrets** (Settings → Secrets and variables → Actions):

| Secret | What |
|---|---|
| `APPLE_CERTIFICATE` | the Developer ID Application certificate exported from Keychain Access as `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | the password set when exporting it |
| `APPLE_ID` | the Apple Account email of the developer membership |
| `APPLE_PASSWORD` | an app-specific password for it (account.apple.com → Sign-In and Security) |
| `APPLE_TEAM_ID` | the team ID, the code in parentheses in the certificate's name |
| `TAURI_SIGNING_PRIVATE_KEY` | the updater private key file's contents (`tauri signer generate`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

The updater's public key is `plugins.updater.pubkey` in `tauri.release.conf.json`. Losing the private key means
installed apps can no longer be updated; keep a copy outside this machine.

**PyPI**: a trusted publisher for each package — owner `TGoddessana`, repository `alpine-code`, workflow
`release.yml`, environment `pypi` for `alpine-code` and `pypi-core` for `alpine-code-core`. PyPI accepts only one
pending publisher per repository, workflow and environment, hence two environments.

## Not yet

- Intel Macs: cryptography (ChatGPT sign-in verifies its ID token) ships no Intel macOS wheels since 49.0, and
  cross-building it from Apple silicon fails.
- Windows: the core does not run there yet (`fcntl` in `secrets.py`, the POSIX `bash` tool).
- An in-app notice that an update is ready.
