# Timelapse setup

This document describes the current Raspberry Pi timelapse setup used by Mariner.

## What is active now

- One global MediaMTX stream path: `cam`
- Live profile switching through the MediaMTX Control API
- Buffered timelapse frame capture in the backend worker
- UV-bottom trigger detection (`uv_light`)
- UV detector runs in simple GPIO polling mode (no interrupt backend)
- Default UV trigger-in pin: `GPIO24` with capture-done-state led out on `GPIO26`

## MediaMTX requirements

File:

```text
/etc/mediamtx/mediamtx.yml
```

Minimum required configuration:

```yaml
api: yes
apiAddress: :9997

paths:
  all_others:
  cam:
    source: rpiCamera
    rpiCameraWidth: 1296
    rpiCameraHeight: 972
    rpiCameraFPS: 25
    rpiCameraBitrate: 4500000
    rpiCameraProfile: main
```

Mariner updates the active camera profile through:

```text
PATCH /v3/config/paths/patch/cam
```

If MediaMTX is not running yet, Mariner can still start, but profile patching logs a warning.

## Camera profiles

### HIGH
- 1296x972
- 25 fps
- 4.5 Mbps

### MID
- 1024x768
- 20 fps
- 3 Mbps

### LOW
- 640x480
- 15 fps
- 1.5 Mbps

## Timelapse storage

Settings:

```text
~/.mariner/timelapse/settings.json
```

Timelapse data:

```text
~/.mariner/timelapse/
```

Legacy data from `/var/tmp/mariner_timelapse/` is migrated when possible.

## Trigger mode

Only one trigger mode is used:

- `uv_light`

The active mode is exposed by `/api/timelapse/status`.

## UV detector

- Input pin defaults to `GPIO24`
- Input uses `PUD_OFF` (no internal pull-up)
- Detection is polling-based and latches one trigger per HIGH phase
- Debounce still applies between trigger events
- Trigger feedback LED pulses on `GPIO26` only after a frame was captured successfully

Optional environment override:

```text
MARINER_UV_SENSOR_PIN=24
```

## Verification steps on Pi

Restart the service:

```bash
sudo systemctl restart mariner3d
sleep 2
```

Check status:

```bash
curl -m 3 -sS http://127.0.0.1:5000/api/timelapse/status
```

Healthy output should show:

```json
{
  "trigger_mode": "uv_light",
  "detector_uv": {
    "interrupt_mode": false,
    "interrupt_backend": "polling",
    "pin": 24,
    "led_pin": 26
  }
}
```

## Notes about local repo vs installed runtime

On the Pi, Mariner may run from the installed virtualenv package path instead of a checkout.
If behavior differs from the repository files, verify which runtime file is active before debugging further.

Recommended UV-bottom capture settings: offset 300 ms, event window 800 ms, timeout 5000 ms.

If buffered capture misses a frame deadline, Mariner falls back to a one-shot ffmpeg snapshot.
