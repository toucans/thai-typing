// einklat measures real e-ink settle latency: submit an update, then block
// on MXCFB_WAIT_FOR_UPDATE_COMPLETE, timing the round trip. This is the
// pixels-on-glass number that dominates keystroke feedback latency.
package main

import (
	"fmt"
	"time"

	"thai-typing/kobo/eink"
)

func bench(fb *eink.FB, name string, wf, mode uint32, r eink.Rect, n int) {
	// warm up
	fb.Fill(r, 0)
	fb.Refresh(r, wf, mode, true)
	var total time.Duration
	var max time.Duration
	for i := 0; i < n; i++ {
		g := byte(0)
		if i%2 == 1 {
			g = 0xFF
		}
		fb.Fill(r, g)
		t0 := time.Now()
		fb.Refresh(r, wf, mode, true) // wait=true → blocks until panel done
		d := time.Since(t0)
		total += d
		if d > max {
			max = d
		}
	}
	fmt.Printf("%-22s avg %3d ms   max %3d ms   (%d samples)\n",
		name, total.Milliseconds()/int64(n), max.Milliseconds(), n)
}

func main() {
	fb, err := eink.Open()
	if err != nil {
		panic(err)
	}
	defer fb.Close()
	fb.Clear()

	small := eink.Rect{Top: 200, Left: 40, W: 300, H: 120} // ~one big glyph
	full := fb.Full()

	bench(fb, "A2 partial (glyph)", eink.WfmA2, eink.UpdatePartial, small, 20)
	bench(fb, "DU partial (glyph)", eink.WfmDU, eink.UpdatePartial, small, 20)
	bench(fb, "GC16 partial (glyph)", eink.WfmGC16, eink.UpdatePartial, small, 10)
	bench(fb, "GC16 full (flush)", eink.WfmGC16, eink.UpdateFull, full, 6)
}
