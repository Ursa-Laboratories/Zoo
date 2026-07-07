# Zoo macOS DMG

This directory builds a macOS DMG containing `Zoo.app` for an operator-facing
Zoo runtime. The app is intentionally local and self-contained: it embeds a
private CPython runtime, prebuilt frontend assets, Zoo/CubOS sources, an offline
wheelhouse, and runtime repair scripts. On first launch, the app creates a
private virtual environment under the user's Application Support folder,
installs Zoo/CubOS packages from the bundled wheelhouse, seeds configs, starts
Zoo, and opens the browser.

The operator Mac does not need Python, Node.js, Git, or internet access.

## What The DMG Targets

- Zoo repo: `https://github.com/Ursa-Laboratories/Zoo.git`, branch `main`
- CubOS repo: `https://github.com/Ursa-Laboratories/CubOS.git`, branch `main`
- App bundle: `Zoo.app`
- Runtime: app-embedded CPython 3.11 from `python-build-standalone`
- Virtual environment: `~/Library/Application Support/UrsaLabs/Zoo/runtime/venv`
- User config directory: `~/Library/Application Support/UrsaLabs/Zoo/configs`
- User data database: `~/Library/Application Support/UrsaLabs/Zoo/data/panda_data.db`
- Logs: `~/Library/Logs/UrsaLabs/Zoo`

The DMG includes ASMI public driver support by default and installs the public
`godirect` package into the runtime venv. Proprietary drivers, such as UV-Vis
vendor packages, are not bundled.

## Packaging Machine Requirements

Run the build on a macOS machine with:

- Git
- Python 3
- Node.js/npm compatible with the frontend lockfile
- Xcode command line tools
- Internet access for cloning repos, downloading wheels, and downloading the
  standalone CPython archive

## Build

From the Zoo checkout:

```bash
installer/macos/build-dmg.sh --zoo-source-dir "$PWD"
```

The output is written under:

```text
installer/macos/build/dist/
```

The same build can be run from GitHub Actions through the `macOS DMG` workflow.
The workflow builds on `macos-latest` and uploads the generated DMG as the
`zoo-macos-dmg` artifact. Every push to `main` builds the DMG, assigns an
automatic version `0.1.<workflow run number>`, and publishes the `.dmg` to a
GitHub Release tagged `mac-v0.1.<workflow run number>`.

Useful overrides:

```bash
installer/macos/build-dmg.sh \
  --zoo-repo-url https://github.com/Ursa-Laboratories/Zoo.git \
  --cubos-repo-url https://github.com/Ursa-Laboratories/CubOS.git \
  --branch main \
  --zoo-source-dir "$PWD" \
  --app-version 0.1.123 \
  --build-python /usr/local/bin/python3 \
  --python-standalone-release latest \
  --driver-groups asmi
```

Use `--driver-groups none` to build a DMG whose default runtime install has no
optional public driver groups selected. The wheelhouse still includes every
driver requirements file under `installer/macos/requirements/drivers/` so a
runtime repair can use the same offline payload.

For signed distribution, pass a Developer ID Application identity:

```bash
installer/macos/build-dmg.sh \
  --zoo-source-dir "$PWD" \
  --sign-identity "Developer ID Application: Example Org (TEAMID)" \
  --notary-profile zoo-notary
```

Without signing and notarization, macOS may warn operators before the first
launch.

## Operator Flow

1. Open the DMG.
2. Drag `Zoo.app` to `Applications`.
3. Launch `Zoo.app`.

`Zoo.app` binds to `127.0.0.1:8742`, opens the browser, and writes a launch log.
On first launch, if the user config directory has no YAML files, the launcher
copies the bundled CubOS configs into
`~/Library/Application Support/UrsaLabs/Zoo/configs`.

The DMG also includes `Export Zoo Diagnostics.command`. It writes a diagnostics
zip to the desktop containing build info, logs, configs, and Python package
information. If `Zoo.app` has already been copied to Applications, the command
uses that copy; otherwise it uses the app bundle still mounted in the DMG.

## Validation Checklist

Before handing the DMG to an operator:

1. Build the DMG on a clean macOS packaging machine.
2. Install it on a clean macOS test machine with no Python, Node.js, or Git on
   `PATH`.
3. Drag `Zoo.app` to `Applications` and launch it.
4. Confirm `http://127.0.0.1:8742` opens.
5. Confirm `~/Library/Application Support/UrsaLabs/Zoo/configs` contains seeded
   CubOS config YAMLs.
6. Confirm `~/Library/Application Support/UrsaLabs/Zoo/runtime/venv/bin/python`
   exists and can import `zoo`, `gantry`, `deck`, and `protocol_engine`.
7. If ASMI support was selected, confirm the runtime venv can import `godirect`.
8. Confirm the gantry and ASMI hardware are not connected during UI-only smoke
   testing, or keep the machine clear and E-stop reachable during hardware
   tests.
9. Run `Export Zoo Diagnostics.command` and verify the zip includes build info,
   logs, configs, and Python package information.

Hardware-touching actions such as connect, home, jog, calibration, and protocol
runs still require normal lab clearance.
