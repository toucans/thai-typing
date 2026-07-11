// kbecho reads Linux evdev events and prints key presses — the proof step
// for the OTG keyboard, and the input layer the trainer will reuse.
//
// Usage: kbecho [/dev/input/eventN]
// Without an argument it lists all event devices and their names.
package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

const evKey = 0x01

func devName(f *os.File) string {
	var buf [256]byte
	syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), uintptr(0x80000000|(256<<16)|('E'<<8)|0x06),
		uintptr(unsafe.Pointer(&buf)))
	n := 0
	for n < len(buf) && buf[n] != 0 {
		n++
	}
	return string(buf[:n])
}

func main() {
	if len(os.Args) < 2 {
		paths, _ := filepath.Glob("/dev/input/event*")
		for _, p := range paths {
			f, err := os.Open(p)
			if err != nil {
				fmt.Printf("%s: %v\n", p, err)
				continue
			}
			fmt.Printf("%s: %q\n", p, devName(f))
			f.Close()
		}
		fmt.Println("run: kbecho /dev/input/eventN")
		return
	}

	f, err := os.Open(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer f.Close()
	fmt.Printf("reading %q — press keys (Ctrl-C to stop)\n", devName(f))

	// struct input_event, arm32: timeval(8) type(2) code(2) value(4)
	buf := make([]byte, 16)
	for {
		if _, err := f.Read(buf); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		typ := binary.LittleEndian.Uint16(buf[8:])
		code := binary.LittleEndian.Uint16(buf[10:])
		val := int32(binary.LittleEndian.Uint32(buf[12:]))
		if typ == evKey {
			state := map[int32]string{0: "up", 1: "DOWN", 2: "repeat"}[val]
			fmt.Printf("key code=%d %s\n", code, state)
		}
	}
}
