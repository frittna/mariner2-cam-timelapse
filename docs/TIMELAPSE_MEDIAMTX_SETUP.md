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

## Z-top detection (direction-change mode)

The detector is now **direction-change based** (not full-sequence based):

- It detects the start edge of each revolution from `00`.
- It tracks last revolution direction (`up` or `down`).
- It triggers **only when direction changes from up to down**.

For the common bit pattern per revolution:

```text
00 -> 01 -> 11 -> 10 -> 00
```

Direction mapping:

- `invert = false` (`top_entry_sensor = A`):
  - `00 -> 01` = down
  - `00 -> 10` = up
- `invert = true` (`top_entry_sensor = B`):
  - `00 -> 10` = down
  - `00 -> 01` = up

Trigger behavior:

- Up revolutions: no trigger
- First down revolution after up: trigger once
- Following down revolutions: no trigger
- Next change to down after going up again: trigger once

## Frame capture queue behavior

Frame capture is asynchronous (ffmpeg in worker threads). On session end, Mariner now waits for queued frame jobs to finish before the session is considered ended. This prevents rendering too early with missing frames.

Practical note: if one frame capture takes ~2 seconds on your Pi, a trigger interval below that can still queue work, but end-session now drains that queue first.

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
