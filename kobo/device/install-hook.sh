#!/bin/sh
# Installs the thai-typing boot hook into /etc/init.d/rcS on the Kobo.
# Run ON THE DEVICE (over ssh). Idempotent; refuses to double-install.
#
# The hook runs /mnt/onboard/.thai/run.sh instead of nickel — but only if
# it exists, is executable, and /mnt/onboard/.thai/disable is absent.
# run.sh exiting non-zero falls through to the stock nickel boot, so a
# missing/broken app can never brick the boot. Recovery layers, in order:
#   1. touch /mnt/onboard/.thai/disable (over USB mass storage or ssh)
#   2. restore /etc/init.d/rcS.thai-bak over ssh
#   3. reinstall any KoboRoot.tgz (rewrites rootfs) via USB
#   4. full card image on lexar: Backup/kobo-clara-hd/
set -e

RCS=/etc/init.d/rcS

if grep -q thai-typing $RCS; then
	echo "hook already installed"
	exit 0
fi

cp $RCS $RCS.thai-bak

awk '
/^\/usr\/local\/Kobo\/hindenburg &/ && !done {
	print "# thai-typing appliance hook — kobo/ in github.com/toucans/thai-typing"
	print "if [ -x /mnt/onboard/.thai/run.sh ] && [ ! -e /mnt/onboard/.thai/disable ]; then"
	print "\tif /mnt/onboard/.thai/run.sh; then"
	print "\t\texit 0"
	print "\tfi"
	print "fi"
	done=1
}
{ print }
' $RCS.thai-bak > $RCS.thai-new

# The hook must have landed exactly once, and the result must parse.
[ "$(grep -c 'thai-typing appliance hook' $RCS.thai-new)" = 1 ]
sh -n $RCS.thai-new

cp $RCS.thai-new $RCS
chmod 755 $RCS
rm $RCS.thai-new
sync
echo "hook installed; pristine copy at $RCS.thai-bak"
