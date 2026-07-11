#!/bin/sh
# Switch the Clara HD's USB controller to host mode (keyboard side).
# Revert with otg-gadget.sh or a reboot.
grep -q debugfs /proc/mounts || mount -t debugfs none /sys/kernel/debug
echo host > /sys/kernel/debug/ci_hdrc.0/role
cat /sys/kernel/debug/ci_hdrc.0/role
