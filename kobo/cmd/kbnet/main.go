// kbnet runs on the Kobo: it listens for keystream datagrams from
// cmd/kbforward on the NUC, echoes each key to stdout, and toggles a square
// on the e-ink per keydown — the end-to-end proof that typed keys cross the
// WiFi hop onto the glass. Reports dropped datagrams via sequence gaps.
//
// Usage: kbnet [listen-addr]   (default ":7768")
package main

import (
	"fmt"
	"log"
	"net"
	"os"

	"thai-typing/kobo/eink"
	"thai-typing/kobo/keystream"
)

func main() {
	addr := fmt.Sprintf(":%d", keystream.Port)
	if len(os.Args) > 1 {
		addr = os.Args[1]
	}
	conn, err := net.ListenPacket("udp", addr)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("listening on %s\n", addr)

	fb, err := eink.Open()
	if err != nil {
		fmt.Printf("no e-ink (%v) — echo only\n", err)
	} else {
		defer fb.Close()
		fb.Clear()
	}

	// The toggling square: centered, flipped black/white on each keydown
	// with A2 and no wait — submit and continue, per the latency budget.
	var sq eink.Rect
	if fb != nil {
		sq = eink.Rect{Top: uint32(fb.H/2 - 100), Left: uint32(fb.W/2 - 100), W: 200, H: 200}
	}
	black := false

	var lastSeq uint8
	first := true
	buf := make([]byte, 64)
	for {
		n, from, err := conn.ReadFrom(buf)
		if err != nil {
			log.Fatal(err)
		}
		e, ok := keystream.Decode(buf[:n])
		if !ok {
			continue // keepalive
		}
		if !first && e.Seq != lastSeq+1 {
			fmt.Printf("LOST %d datagram(s) before seq %d\n", e.Seq-lastSeq-1, e.Seq)
		}
		first, lastSeq = false, e.Seq

		state := map[uint8]string{0: "up", 1: "DOWN", 2: "repeat"}[e.Value]
		fmt.Printf("%-10s %-6s (code=%d seq=%d from %s)\n", keystream.Name(e.Code), state, e.Code, e.Seq, from)

		if fb != nil && e.Value == keystream.Down {
			black = !black
			gray := byte(0xFF)
			if black {
				gray = 0x00
			}
			fb.Fill(sq, gray)
			fb.Refresh(sq, eink.WfmA2, eink.UpdatePartial, false)
		}
	}
}
