🔴 **Mariner 2 Cam Timelapse (Pi Zero 2)**
🔴 [github.com/frittna/mariner2cam/edit/mariner2cam-timelapse](https://github.com/frittna/mariner2-cam-timelapse) - 14:39-24.July.2026+AI

This is the timelapse-focused variant of my Mariner 2 Cam fork.
It keeps the base Mariner workflow, but adds a practical print-timelapse pipeline and several stability improvements.

## What is different in this version

- Timelapse sessions with video rendering (25/30/60 fps presets)
- Optional skip-frames rendering for long prints
- UV-bottom trigger mode only (`uv_light`) for more stable captures
- MediaMTX live camera profile switching (HIGH/MID/LOW)
- Better serial/status resilience during print polling
- Better UI feedback for file actions and upload, cancel a print and rendering a video
- Temperautre sensor display added (°C/°F with BMP280 I2C)
- Offline indicator when page open but host not reachable

## Timelapse method used

The earlier Z-top trigger experiments were too jitter-prone in real use.
This version uses UV-bottom triggering instead (3.3V signal to `GPIO24`, no internal pull-up), which gives more reliable capture timing during real print exposure phases.

For this i use a small opto-coupler board to convert the UV-Light_FAN connector signal on my Mars 3 printer mainboard to 3.3V.

Btw: The lables on my original printer mainboard were mixed up (printed wrong) so if you get confused try the MB-Fan connector instead when you play around with the printable config file to set them up how they shoud act.

Also, frame grabbing now runs as a buffered/background process while a session is active, instead of repeatedly starting/stopping per trigger.

Some technical details ➡️ **[Timelapse + MediaMTX details](docs/TIMELAPSE_MEDIAMTX_SETUP.md)**

## Hardware / runtime notes

- Use an external **5V / 1.5A+** PSU for the Pi.
- High profile streaming and capture can keep CPU load elevated for long time so active cooling is recommended.
- A complete guide to load it straigt from github will follow i guess but i can't make these things because i dont know how to do it. But you can find a long detailed instruciton how to install mariner2cam on top of mariner2 a bit below. Then modify and create all new files from mariner2cam-timelapse since mariner2cam and compile them again. 
  
## Screenshots / demo

![grafic6](docs/Screenshot6.jpg)
#

![grafic5](docs/Screenshot5.jpg)
#

![grafic7](docs/Screenshot7.jpg)
#

![grafic8](docs/Screenshot8.jpg)
#

small opto-coupler board with 3.3V GPOI und additional output:
![grafic9](docs/opto-board_24v-3_3V.jpg)
#


-> Demo video: (the print object is very small so we see nothing of it - its just a test - will print large things soon)
[Demo-Video](docs/test_video_Ball_2026-07-19--18-39.mp4)




# from here on it isn't false, but outdated since there was no timelapse feature present at that time:

🔴 Mariner 2 Cam for Pi Zero 2

### 3D-Printer Monitoring Tool with Camera Support, WLAN OTG-USB-Gadget, Firewall, VPN, Fail2ban, Webmin and a physical shutdown  ###
**Status:** Work-in-progress, but working stable and fine now. I went through all the steps in my guide again from a fresh install to test it.

You will need a external power adapter for you Pi for sure and be careful that you not run into the double-power problem of your pi+printer.

>**Chitobox-Note:** The ctb decryption from amd989 had to be modified a bit to work on new `.ctb` files (is it a bug or caused by a Chitobox update?).

---

 **GitHub-Project:**
 
  🔴 [https://github.com/frittna/mariner2cam]  * **Last Changes:** 17:53 - 03.June.2026
  
  Is a fork from the great Mariner 2 (amd989)    - [https://github.com/amd989/mariner]
  
  Which was a fork from Mariner (luizribeiro)    - [https://github.com/luizribeiro/mariner]

---

### 📖 Complete Installation Guide & Code

A tested full step-by-step guide to make a fresh Zero 2 W installation can be found here.
You can run it yourself by following this tutorial in 1-2 hours (in German at the moment).

➡️ **[Click here to view: CompleteInstructionZero2.txt](CompleteInstructionZero2.txt)**

---

* **Note for Pi Zero 1.1:** There is a separate instruction for the Zero 1.1 which was *NOT COMPATIBLE* at the beginning with today's automatic scripts. But the Zero 1 is weak and I sold it, so it will not have the same state of progress. If you want to run it on the Zero 1, see the file: `"Anleitung - Mariner2 - PI Zero W 1.1+2 outdated (ARM6).txt"`.

---

### Screenshots

![grafic1](docs/Screenshot1hide_DB.jpg)
.
![grafic2](docs/Screenshot1max_DB.jpg)
.
![grafic3](docs/Screenshot3min_FM.jpg)
.
![grafic4](docs/Screenshot4print_preview.jpg)
.
