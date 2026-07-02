# Timelapse - MediaMTX setup

The Raspberry Pi camera (`rpiCamera`) can only provide **one** live source at a time.
Mariner therefore uses a single global `cam` path and updates its quality settings live through the MediaMTX Control API.

## Current camera profiles

These are the profiles used by the UI and the backend:

### HIGH - 1296x972, 30 fps, 4 Mbps
Best image quality for detailed timelapse captures.

### MID - 1024x768, 20 fps, 2 Mbps
Balanced 4:3 profile with lower load than HIGH.

### LOW - 640x480, 15 fps, 800 kbps
Lowest load and smallest files. Uses the `main` profile as well.

## Required MediaMTX configuration

File:

```text
/etc/mediamtx/mediamtx.yml
```

The `cam` path must exist and must use `rpiCamera`.
The Control API must also be enabled.

Example:

```yaml
api: yes
apiAddress: :9997

paths:
  all_others:
  cam:
    source: rpiCamera
    rpiCameraWidth: 1296
    rpiCameraHeight: 972
    rpiCameraFPS: 30
    rpiCameraBitrate: 4000000
    rpiCameraProfile: main
```

## How profile switching works now

Mariner updates the existing `cam` path through:

```text
PATCH /v3/config/paths/patch/cam
```

That means:

- the selected UI profile is applied live
- the stream path stays `cam`
- MediaMTX must expose the Control API on port `9997`

## Persistent timelapse settings

Selected timelapse settings are stored at:

```text
~/.mariner/timelapse/settings.json
```

Legacy settings from:

```text
/var/tmp/mariner_timelapse/settings.json
```

are migrated automatically when present.

## Z-top detection

The detector now uses a directional transition into `(True, True)` instead of triggering on every `(True, True)` state.

Default top-entry mode:

- sensor A enters first: `(True, False) -> (True, True)`

Inverted mode:

- sensor B enters first: `(False, True) -> (True, True)`

The UI exposes this as an **Invert** toggle in the Sensors section.

## Files updated in this change

```text
frontend/src/App.tsx
frontend/src/components/AppNav.tsx
frontend/src/hooks/use-temperature-unit.ts
frontend/src/lib/api.ts
frontend/src/lib/temperature.ts
frontend/src/pages/Files.tsx
frontend/src/pages/Index.tsx
frontend/src/pages/Settings.tsx
frontend/src/pages/Timelapse.tsx
mariner/server/routes_timelapse.py
mariner/server/timelapse_manager.py
mariner/server/timelapse_worker.py
mariner/server/z_spindle_detector.py
mariner/tests/test_z_spindle_detector.py
```
