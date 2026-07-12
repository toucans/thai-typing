// kbforward runs on the NUC: it grabs the keyboard's evdev node exclusively
// (so keys don't also type into the local console) and streams key events to
// the Kobo over UDP, with a ~100 ms keepalive that keeps the Kobo's radio
// out of power-save. Survives unplug/replug by rescanning.
//
// Usage: kbforward [-dev /dev/input/eventN] <kobo-host[:port]>
//
// Linux amd64 only (the NUC); the Kobo side is cmd/kbnet.
package main

import (
	"encoding/binary"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"thai-typing/kobo/keystream"
)

const (
	evKey = 0x01

	// EVIOCGNAME(256), EVIOCGBIT(ev,len), EVIOCGRAB — evdev ioctls, amd64.
	eviocgname = 0x80000000 | 256<<16 | 'E'<<8 | 0x06
	eviocgrab  = 0x40000000 | 4<<16 | 'E'<<8 | 0x90

	// Keys a real keyboard must have: a, enter, space.
	keyA, keyEnter, keySpace = 30, 28, 57
)

func ioctl(fd uintptr, req uintptr, arg unsafe.Pointer) error {
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, req, uintptr(arg))
	if errno != 0 {
		return errno
	}
	return nil
}

func eviocgbit(ev, length int) uintptr {
	return uintptr(0x80000000 | length<<16 | 'E'<<8 | (0x20 + ev))
}

func devName(f *os.File) string {
	var buf [256]byte
	ioctl(f.Fd(), eviocgname, unsafe.Pointer(&buf))
	n := 0
	for n < len(buf) && buf[n] != 0 {
		n++
	}
	return string(buf[:n])
}

func hasBit(bits []byte, n int) bool { return bits[n/8]&(1<<(n%8)) != 0 }

// isKeyboard reports whether the device claims EV_KEY plus the letter keys —
// capability bits, not names, so any keyboard qualifies and buttons don't.
func isKeyboard(f *os.File) bool {
	var evbits [4]byte
	if ioctl(f.Fd(), eviocgbit(0, len(evbits)), unsafe.Pointer(&evbits)) != nil {
		return false
	}
	if !hasBit(evbits[:], evKey) {
		return false
	}
	var keybits [96]byte
	if ioctl(f.Fd(), eviocgbit(evKey, len(keybits)), unsafe.Pointer(&keybits)) != nil {
		return false
	}
	return hasBit(keybits[:], keyA) && hasBit(keybits[:], keyEnter) && hasBit(keybits[:], keySpace)
}

// findKeyboard scans /dev/input for the first device with keyboard
// capabilities and returns it opened.
func findKeyboard() *os.File {
	paths, _ := filepath.Glob("/dev/input/event*")
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		if isKeyboard(f) {
			return f
		}
		f.Close()
	}
	return nil
}

func main() {
	devFlag := flag.String("dev", "", "input device (default: autodetect a keyboard)")
	flag.Parse()
	if flag.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: kbforward [-dev /dev/input/eventN] <kobo-host[:port]>")
		os.Exit(2)
	}
	addr := flag.Arg(0)
	if !strings.Contains(addr, ":") {
		addr = fmt.Sprintf("%s:%d", addr, keystream.Port)
	}
	conn, err := net.Dial("udp", addr)
	if err != nil {
		log.Fatal(err)
	}

	// Keepalive runs regardless of keyboard state: its whole job is keeping
	// the Kobo's radio hot so the next real keystroke lands in 2–3 ms.
	go func() {
		for range time.Tick(100 * time.Millisecond) {
			conn.Write(keystream.Keepalive)
		}
	}()

	var seq uint8
	buf := make([]byte, 24) // struct input_event, amd64: timeval(16) type(2) code(2) value(4)
	waiting := false
	for {
		var f *os.File
		if *devFlag != "" {
			f, err = os.Open(*devFlag)
			if err != nil {
				log.Fatal(err)
			}
		} else if f = findKeyboard(); f == nil {
			if !waiting {
				log.Print("no keyboard found, waiting for one")
				waiting = true
			}
			time.Sleep(time.Second)
			continue
		}
		waiting = false

		grabbed := 1
		if err := ioctl(f.Fd(), eviocgrab, unsafe.Pointer(&grabbed)); err != nil {
			log.Printf("EVIOCGRAB %s: %v (another grabber?), retrying", f.Name(), err)
			f.Close()
			time.Sleep(time.Second)
			continue
		}
		log.Printf("forwarding %q (%s) → %s", devName(f), f.Name(), addr)

		for {
			if _, err := f.Read(buf); err != nil {
				log.Printf("keyboard gone (%v), rescanning", err)
				break
			}
			if binary.LittleEndian.Uint16(buf[16:]) != evKey {
				continue
			}
			e := keystream.Event{
				Code:  binary.LittleEndian.Uint16(buf[18:]),
				Value: uint8(binary.LittleEndian.Uint32(buf[20:])),
				Seq:   seq,
			}
			seq++
			conn.Write(keystream.Encode(e))
		}
		f.Close()
		if *devFlag != "" {
			os.Exit(1)
		}
	}
}
