#!/bin/sh
# thai-typing appliance launcher, called by the rcS hook in place of nickel.
# Contract with rcS: exit 0 = we own the session (nickel never starts);
# exit non-zero = fall through to the stock nickel boot.
#
# Lives at /mnt/onboard/.thai/run.sh — update by copying over USB/ssh.

THAI=/mnt/onboard/.thai
APP=$THAI/thai-kobo

[ -x "$APP" ] || exit 1

# USB port to host mode so the keyboard enumerates.
grep -q debugfs /proc/mounts || mount -t debugfs none /sys/kernel/debug
echo host > /sys/kernel/debug/ci_hdrc.0/role 2>/dev/null

# Supervise the app: restart on crash, but bail out to a reboot (and
# thereby a fresh attempt, or nickel after `touch disable`) if it
# crash-loops. Backgrounded so rcS can finish and init stays happy.
(
	fails=0
	while :; do
		start=$(date +%s)
		"$APP" >> $THAI/app.log 2>&1
		rc=$?
		[ $rc -eq 0 ] && poweroff && exit
		now=$(date +%s)
		if [ $((now - start)) -lt 15 ]; then
			fails=$((fails + 1))
		else
			fails=0
		fi
		if [ $fails -ge 3 ]; then
			touch $THAI/disable
			reboot
			exit
		fi
	done
) &

exit 0
