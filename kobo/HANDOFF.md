# HANDOFF — picking up the Kobo thai-typing appliance

A cold-start guide for a fresh Claude Code session (Fable) to continue this
project. Read `README.md` in this directory first for the device facts, ABI
numbers, and recovery ladder — this file does **not** repeat them; it covers
how to *connect, operate, and continue the work*.

## Scope & what this is (read first)

This is **homebrew on johan's own Kobo Clara HD e-reader** — turning a device
he owns into a Thai typing trainer. It uses Kobo's **official Developer Mode**
and the vendor's own **`KoboRoot.tgz`** firmware-update mechanism (the same
path Kobo uses to install updates). Root access is via NiLuJe's long-standing,
publicly documented KoboStuff package. Nothing here circumvents protections
that guard anyone else's system or content — it's personal-device
customization, the e-reader equivalent of installing Linux on a laptop you own.

**Out of scope for this repo:** an earlier conversation floated porting the
project to a Kindle. That is *not* part of this work and should not be pursued
here — this handoff and repo are Kobo-only. If asked about the Kindle, treat it
as a separate question, not a task in this project.

## The mission

thai-typing (see the top-level `../README.md`) is johan's self-hosted Thai
typing trainer — a Go server + web UI on the NUC. This `kobo/` subtree adds a
**second frontend**: the Clara HD boots straight into a stripped-down trainer
drawn on the e-ink screen, no Nickel, no browser. It shares the lesson data and
JSONL progress format with the web app. One static Go binary on the device.

## Current state (2026-07-11/12) — everything proven except live typing

Done, verified on hardware:
- **Root over WiFi.** kobo-stuff installed, dropbear key-only, telnet/ftp off.
- **Go framebuffer drawing** on the e-ink panel (the `eink` package): A2 fast
  refresh + GC16 flush both work.
- **Shaped Thai** rendered on the NUC (Pillow+raqm+Sarabun) and blitted to the
  panel with correct tone-mark stacking.
- **Boot hook** in `/etc/init.d/rcS` (falls through to Nickel until an app
  binary exists), reboot-tested. Hardening survived reboot.
- **Full internal-card image** on the lexar (see README recovery ladder).
- **Measured latency budget** (see "Input architecture" below).

Not done: **live keyboard input** — see below. This is the current frontier.

## How to connect to the Kobo

The device is on WiFi (DHCP; was `192.168.1.146`, may change). Find it and get
a root shell:

```sh
# find it (scan LAN for its ssh port)
for i in $(seq 1 254); do (timeout 0.4 bash -c "echo >/dev/tcp/192.168.1.$i/22" 2>/dev/null && echo "ssh: 192.168.1.$i" &); done; wait

# key is already installed on the device:
ssh -i ~/.ssh/intelnuc -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@<ip>
```

If the Kobo shows **"connected to computer"** and drops off WiFi: something is
back-feeding USB VBUS into its port. Unplug whatever is in the USB port; WiFi
returns in a few seconds. (Nickel disables WiFi during USB mass-storage.)

## Build & deploy

```sh
# cross-compile for the Clara HD (i.MX6, armv7)
cd ~/thai-typing
GOOS=linux GOARCH=arm GOARM=7 go build -ldflags="-s -w" -o /tmp/xxx ./kobo/cmd/<tool>
scp -i ~/.ssh/intelnuc -O <binary> root@<ip>:/mnt/onboard/.thai/
```

App files live on the FAT partition `/mnt/onboard/.thai/` — updating is a file
copy, the rootfs is never touched again. Existing staged tools there: `fbtest`,
`kbecho`, `run.sh`, the OTG scripts. `/tmp/einklat` is the latency benchmark.

## Input architecture — the decided path: stream from the NUC

We spent an evening proving that **direct USB keyboard input on the Clara HD is
a dead end**: the port sources no VBUS (confirmed in the mainline device tree —
no `vbus-supply`, no boost regulator on the RC5T619 PMIC), and every
externally-powered-hub workaround either back-feeds VBUS (→ "connected to
computer", WiFi drops) or reset-loops (fussy high-speed hub vs. the Kobo's
VBUS-less OTG session). A powered micro-USB OTG-Y cable would work but adds
hardware.

**Chosen instead: the keyboard lives on the NUC; keystrokes stream to the Kobo
over WiFi.** This is measured to be effectively free, because e-ink dominates:

| stage | measured |
|---|---|
| keyboard → NUC evdev | ~2–5 ms |
| UDP hop NUC → Kobo (radio active) | **2–3 ms** (RTT 1.6–6.4) |
| app + ioctl submit | ~5 ms |
| **A2 e-ink settle (char appears)** | **119 ms** (steady; DU 226, GC16 448, full-flush 561) |
| **total keypress→glass** | **~130 ms** |

The WiFi hop is <3% of the total. A local keyboard would be ~125 ms; streamed
is ~130 ms — imperceptible behind the 119 ms e-ink refresh.

**One caveat, measured:** when the radio is idle between keystrokes, the Realtek
driver's power-save adds a **50–100 ms wake spike to the first packet after a
pause** (independent of `iwconfig ... Power Management:off`). Fix: the NUC
forwarder sends a **keepalive every ~100 ms** to keep the radio hot → flat
2–3 ms. Cheap.

### The keyboard on the NUC — status & options

The NUC has an **Intel AX201 Bluetooth adapter** (present in `lsusb`), but as of
this writing **BlueZ is not installed** (`bluetooth.service` doesn't exist) and
`uhid` isn't loaded. Two ways to give the NUC a keyboard:

1. **johan's Bluetooth keyboard** — needs `bluez` installed on the NUC, then
   pair with `bluetoothctl`. Note: this adds a persistent daemon, which cuts
   against johan's lean-box principle ([[trim-unused-daemons]]) — **flag it and
   let him decide** whether to `systemctl enable` it or run it on demand.
2. **A plain USB keyboard in the NUC** — zero new daemons, shows up as
   `/dev/input/eventX` immediately. Simplest; recommend for first prototype.

Either way the software is identical: a keyboard is a `/dev/input/eventX` on the
NUC regardless of BT vs USB.

### What to build next (the frontier)

Two small pieces, then the app:

1. **`cmd/kbforward/` (runs on the NUC).** Grab the keyboard's
   `/dev/input/eventX` exclusively (`EVIOCGRAB` ioctl, so keys don't also type
   into the NUC console), serialize key events, UDP-send to the Kobo, plus a
   ~100 ms keepalive. Reuse the evdev decoding already written in
   `cmd/kbecho/main.go`. Pick the device robustly (match a keyboard by
   `/dev/input/by-id/*-kbd` or capability bits, not a hardcoded eventN).
2. **UDP receiver on the Kobo.** Extend `kbecho` (or a new `cmd/kbnet/`) to
   listen on UDP and print received keys — the end-to-end proof: type on the
   NUC keyboard, watch it echo on the Kobo screen. No new hardware needed.
3. **`thai-kobo` (the app).** Input source is swappable (local evdev *or* UDP)
   behind one handler. Draw with the `eink` package: A2 per keystroke, GC16
   flush between words/drills. Don't block on the 119 ms settle — submit and
   continue so fast typing coalesces. Share the word pool with the web app
   (`web/js/data/words.js`) via a build-time step; pre-render Thai clusters into
   an atlas (`tools/render-thai.py` is the ancestor) so the device carries zero
   font tech.

### UI decisions still open (ask johan)

- Which mode first: speed-journey word bursts, or a fresh minimal e-ink drill.
- Screen layout: single huge word vs. word+context line vs. line-at-a-time prose.
- Progress sync: WiFi POST to the `:8768` server (merges into
  `~/keep/thai-typing/users/`) vs. local-only JSONL for the first milestone.

## Repo map

- `README.md` — device facts, ABI, layout, recovery ladder (source of truth).
- `eink/` — Go framebuffer + EPDC refresh package.
- `cmd/fbtest`, `cmd/kbecho`, `cmd/einklat` — proofs/benchmarks.
- `device/` — `run.sh` (launcher), `install-hook.sh`, `harden.sh`, OTG scripts,
  `rcS.pristine-fw4.38`.
- `tools/render-thai.py`, `assets/` — Thai rendering pipeline + fonts.

## If the future device is a bigger Kobo

johan is considering a **Kobo Elipsa 2E** (10.3" B&W, the biggest) — it has
Bluetooth, so a BT keyboard pairs to it *directly* (no NUC streaming). But it's
MediaTek/arm64 with a **different EPDC**, so the `eink` ioctl layer is a re-port
(FBInk supports it as reference), and builds flip to `GOARCH=arm64`. Everything
above the display layer carries over.
