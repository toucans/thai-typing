#!/bin/sh
# Switch the Clara HD's USB controller back to gadget (device) mode.
grep -q debugfs /proc/mounts || mount -t debugfs none /sys/kernel/debug
echo gadget > /sys/kernel/debug/ci_hdrc.0/role
cat /sys/kernel/debug/ci_hdrc.0/role
