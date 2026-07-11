#!/bin/sh
# Locks down kobo-stuff remote access: key-only dropbear, no telnet/ftp.
# Run ON THE DEVICE. Takes effect at next boot (running daemons untouched).
# Precondition: a working key in /usr/local/niluje/usbnet/etc/authorized_keys
# — verify key login BEFORE running this or you lock yourself out (recovery:
# reinstall kobo-stuff KoboRoot.tgz over USB).
set -e

ETC=/usr/local/niluje/usbnet/etc
SD=/usr/local/stuff/bin/stuff-daemons.sh

test -s $ETC/authorized_keys

sed -i 's/^SSHD_OPTS="${SSHD_OPTS} -n"$/#&/' $SD
sed -i 's/^#SSHD_OPTS="${SSHD_OPTS} -s"$/SSHD_OPTS="${SSHD_OPTS} -s"/' $SD
touch $ETC/NO_TELNET
sync

echo "dropbear opts now:"
grep '^#*SSHD_OPTS=' $SD
