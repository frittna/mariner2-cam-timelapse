# Timelapse MediaMTX Setup

Minimaler Block für die Timelapse-Profile.

## Eintragen in `/etc/mediamtx/mediamtx.yml`

```yaml
paths:
  cam_high:
    source: rtsp://192.168.X.X:322/live/cameraNumber?profile=high
    sourceProtocol: tcp

  cam_mid:
    source: rtsp://192.168.X.X:322/live/cameraNumber?profile=medium
    sourceProtocol: tcp

  cam_low:
    source: rtsp://192.168.X.X:322/live/cameraNumber?profile=low
    sourceProtocol: tcp

  cam:
    source: rtsp://192.168.X.X:322/live/cameraNumber?profile=high
    sourceProtocol: tcp
```

## Entfernen

- alte doppelte `cam_high` / `cam_mid` / `cam_low` Blöcke
- alte `cam`-Weiterleitungen auf nicht existierende Pfade

## Danach

```bash
sudo systemctl restart mediamtx
sudo systemctl restart mariner3d
```
