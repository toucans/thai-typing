// fbtest exercises the eink package on the device: reports fb geometry,
// draws a test pattern with a GC16 full refresh, then A2-flashes a box —
// the two refresh styles the trainer will live on.
//
// Usage: fbtest [image.gray]
// With an argument, blits a raw 8-bit grayscale image (width*height bytes,
// W and H read from the first 8 bytes as two uint32-LE) centered on screen.
package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"time"

	"thai-typing/kobo/eink"
)

func main() {
	fb, err := eink.Open()
	if err != nil {
		fmt.Fprintln(os.Stderr, "open:", err)
		os.Exit(1)
	}
	defer fb.Close()
	fmt.Printf("fb: %dx%d bpp=%d stride=%d mem=%dKiB\n",
		fb.W, fb.H, fb.BPP, fb.Stride, len(fb.Mem)/1024)

	if err := fb.Clear(); err != nil {
		fmt.Fprintln(os.Stderr, "clear:", err)
		os.Exit(1)
	}

	if len(os.Args) > 1 {
		blitGray(fb, os.Args[1])
		return
	}

	// Border frame.
	w, h := uint32(fb.W), uint32(fb.H)
	fb.Fill(eink.Rect{Top: 20, Left: 20, W: w - 40, H: 8}, 0)
	fb.Fill(eink.Rect{Top: h - 28, Left: 20, W: w - 40, H: 8}, 0)
	fb.Fill(eink.Rect{Top: 20, Left: 20, W: 8, H: h - 40}, 0)
	fb.Fill(eink.Rect{Top: 20, Left: w - 28, W: 8, H: h - 40}, 0)

	// 16-step grayscale ramp.
	bw := (w - 80) / 16
	for i := uint32(0); i < 16; i++ {
		fb.Fill(eink.Rect{Top: 60, Left: 40 + i*bw, W: bw - 2, H: 120},
			byte(i*17))
	}

	// Checkerboard, center.
	cs := uint32(48)
	for r := uint32(0); r < 8; r++ {
		for c := uint32(0); c < 8; c++ {
			if (r+c)%2 == 0 {
				fb.Fill(eink.Rect{
					Top:  h/2 - 4*cs + r*cs,
					Left: w/2 - 4*cs + c*cs,
					W:    cs, H: cs,
				}, 0)
			}
		}
	}
	if err := fb.Refresh(fb.Full(), eink.WfmGC16, eink.UpdateFull, true); err != nil {
		fmt.Fprintln(os.Stderr, "gc16:", err)
		os.Exit(1)
	}
	fmt.Println("GC16 full refresh OK")

	// A2 keystroke-style flashes: small box lower third.
	box := eink.Rect{Top: h - h/4, Left: w/2 - 100, W: 200, H: 100}
	for i := 0; i < 4; i++ {
		g := byte(0)
		if i%2 == 1 {
			g = 0xFF
		}
		fb.Fill(box, g)
		if err := fb.Refresh(box, eink.WfmA2, eink.UpdatePartial, true); err != nil {
			fmt.Fprintln(os.Stderr, "a2:", err)
			os.Exit(1)
		}
		time.Sleep(150 * time.Millisecond)
	}
	fmt.Println("A2 partial refreshes OK")
}

// blitGray centers a raw grayscale image (header: uint32-LE W, H) and
// refreshes it — used to preview NUC-rendered Thai text on the panel.
func blitGray(fb *eink.FB, path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	iw := int(binary.LittleEndian.Uint32(data[0:]))
	ih := int(binary.LittleEndian.Uint32(data[4:]))
	pix := data[8:]
	x0, y0 := (fb.W-iw)/2, (fb.H-ih)/2
	for y := 0; y < ih; y++ {
		for x := 0; x < iw; x++ {
			fb.SetPixel(x0+x, y0+y, pix[y*iw+x])
		}
	}
	r := eink.Rect{Top: uint32(y0), Left: uint32(x0), W: uint32(iw), H: uint32(ih)}
	if err := fb.Refresh(r, eink.WfmGC16, eink.UpdatePartial, true); err != nil {
		fmt.Fprintln(os.Stderr, "refresh:", err)
		os.Exit(1)
	}
	fmt.Printf("blitted %dx%d at %d,%d\n", iw, ih, x0, y0)
}
