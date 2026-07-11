# kobo/ — thai-typing as an e-ink appliance

A second frontend for thai-typing: johan's old **Kobo Clara HD** boots straight
into a Thai typing trainer driven by a wired USB keyboard. One static Go
binary drawing on the e-ink framebuffer — no nickel, no KOReader, no X.
Build principles live in `~/.claude/CLAUDE.md`; this file holds only what's
specific to the device and this port.

## Device facts (recon 2026-07-11)

| Fact | Value |
|---|---|
| Model | Clara HD ("Nova", model ID 376, Mark 7), serial N249860138789 |
| SoC / kernel | i.MX6SLL, Linux 4.1.15, busybox userland |
| Panel | 1072×1448 @ 300dpi, `mxc_epdc_fb`, 32bpp BGRA, stride 4352 |
| Refresh ABI | `MXCFB_SEND_UPDATE` v2 (72-byte struct, ioctl `0x4048462E`), wait `0xC008462F` — per FBInk `eink/mxcfb-kobo.h` |
| Waveforms | DU=1 GC16=2 A2=4 AUTO=257; `TEMP_USE_AMBIENT=0x1000` |
| Storage | internal microSD `mmcblk0` 7.4GiB: p1 rootfs (256M), p2 recovery, p3 user FAT (`/mnt/onboard`, the `KOBOeReader` USB volume) |
| USB OTG | `ci_hdrc.0`, role via `echo host > /sys/kernel/debug/ci_hdrc.0/role`; kernel has `CHIPIDEA_HOST`+EHCI+`USB_HID`+`HID_GENERIC`+evdev built in |
| WiFi | RTL8189 (`eth0`), joins Zyxel_F0B1, DHCP (find with an ssh-port scan) |
| No Bluetooth | wired/dongle keyboards only |

Root access: NiLuJe kobo-stuff 1.6.N (dropbear+telnet at boot via udev hook,
FBInk/evtest/fbgrab/rsync/tmux on board). `ssh -i ~/.ssh/intelnuc root@<ip>`;
key in `/usr/local/niluje/usbnet/etc/authorized_keys`.

## Layout

- `eink/` — Go package: fb mmap, draw, EPDC refresh ioctls. The app's display layer.
- `cmd/fbtest/` — test pattern + raw-gray blit (proven on device 2026-07-11).
- `cmd/kbecho/` — evdev key echo, for the keyboard test and beyond.
- `tools/render-thai.py` — shaped-Thai → raw gray (Pillow+raqm); ancestor of the build-time cluster-atlas generator (device gets pre-shaped bitmaps, zero font tech on-device).
- `device/` — everything that touches the Kobo: `install-hook.sh` (rcS boot hook), `run.sh` (launcher, lives at `/mnt/onboard/.thai/`), `otg-host.sh`/`otg-gadget.sh`, `rcS.pristine-fw4.38`.
- `assets/` — Sarabun TTFs (build-time input only).

Cross-compile: `GOOS=linux GOARCH=arm GOARM=7 go build ./kobo/cmd/...`

## Boot design

`/etc/init.d/rcS` gets one guarded hook (see `device/install-hook.sh`) just
before the nickel launch: if `/mnt/onboard/.thai/run.sh` exists and
`/mnt/onboard/.thai/disable` doesn't, it runs; returning 0 skips nickel,
anything else falls through to the stock boot. `run.sh` switches USB to host
mode and supervises the app; a crash-loop re-enables nickel by touching
`disable` and rebooting. All app files live on the FAT partition — updating
is a file copy, the rootfs is touched exactly once.

## Recovery ladder

1. `touch /mnt/onboard/.thai/disable` (USB mass storage or ssh) → stock boot.
2. Restore `/etc/init.d/rcS.thai-bak` over ssh.
3. Reinstall any `KoboRoot.tgz` over USB (firmware reruns it as root).
4. Full card image: `/mnt/lexar/Backup/kobo-clara-hd/mmcblk0-fw4.38-2026-07-11.img.zst` (+ pristine rcS) — needs opening the back cover to reach the microSD.

## Progress sharing

Same JSONL progress format as the web app, written to
`/mnt/onboard/.thai/`, POSTed opportunistically to the NUC server (:8768)
which merges into `~/keep/thai-typing/users/` — one user store, rides the
restic backup.
