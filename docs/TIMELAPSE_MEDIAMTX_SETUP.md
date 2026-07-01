# Timelapse – MediaMTX Konfiguration

Die Pi-Kamera (`rpiCamera`) kann immer nur **einen** Stream gleichzeitig öffnen.
Profile werden deshalb durch Anpassen des `cam:`-Blocks in der mediamtx.yml
aktiviert – danach beide Dienste neu starten.

---

## Datei: `/etc/mediamtx/mediamtx.yml`

Nur der `paths:`-Abschnitt muss geändert werden. Den gewünschten Profilblock
einfach als `cam:` eintragen, die anderen auskommentiert lassen.

---

### Profil HIGH — 1296×972, 30 fps, 4 Mbit/s
> Beste Qualität. Für Zeitraffer mit viel Detail. Benötigt schnelle SD-Karte.

```yaml
paths:
  all_others:
  cam:
    source: rpiCamera
    rpiCameraWidth: 1296
    rpiCameraHeight: 972
    rpiCameraFps: 30
    rpiCameraBitRate: 4000000     # 4 Mbit/s
    rpiCameraProfile: main
```

---

### Profil MID — 1280×720, 25 fps, 2 Mbit/s
> Ausgewogener Standard. 16:9-Format, geringere Last. Empfohlen für den Alltag.

```yaml
paths:
  all_others:
  cam:
    source: rpiCamera
    rpiCameraWidth: 1280
    rpiCameraHeight: 720
    rpiCameraFps: 25
    rpiCameraBitRate: 2000000     # 2 Mbit/s
    rpiCameraProfile: main
```

---

### Profil LOW — 640×480, 15 fps, 800 kbit/s
> Niedrigste Last, kleinste Dateien. Für lange Drucke oder schwache Hardware.

```yaml
paths:
  all_others:
  cam:
    source: rpiCamera
    rpiCameraWidth: 640
    rpiCameraHeight: 480
    rpiCameraFps: 15
    rpiCameraBitRate: 800000      # 800 kbit/s
    rpiCameraProfile: baseline
```

---

## Profil wechseln

1. Den gewünschten Profilblock oben kopieren
2. In `/etc/mediamtx/mediamtx.yml` den bestehenden `cam:`-Block ersetzen
3. Dienste neu starten:

```bash
sudo systemctl restart mediamtx
sudo systemctl restart mariner3d
```

4. Im Timelapse-UI (oder per API) das passende Profil auswählen:
   `PUT /api/timelapse/profile  {"profile": "MID"}`

> **Hinweis:** Das UI-Profil (HIGH/MID/LOW) ist eine Markierung für die Session-Metadaten
> und den Dateinamen — es steuert **nicht** die Kameraeinstellungen selbst.
> Die tatsächliche Qualität bestimmt allein der aktive `cam:`-Block in der mediamtx.yml.