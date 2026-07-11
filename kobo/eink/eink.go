// Package eink drives the Kobo Clara HD framebuffer directly: mmap of
// /dev/fb0 plus the Mark 7 (i.MX6SLL) EPDC refresh ioctl. ABI per NiLuJe's
// FBInk eink/mxcfb-kobo.h (struct mxcfb_update_data v2, 72 bytes).
//
// The panel is 1072x1448 @ 32bpp; grayscale is written as equal B/G/R.
package eink

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const (
	fbioGetVScreenInfo = 0x4600
	fbioGetFScreenInfo = 0x4602

	// _IOW('F', 0x2E, struct mxcfb_update_data) — 72-byte v2 struct
	mxcfbSendUpdate = 0x4048462E
	// _IOWR('F', 0x2F, struct mxcfb_update_marker_data) — Mark 7 wait
	mxcfbWaitForUpdateComplete = 0xC008462F

	tempUseAmbient = 0x1000
)

// Waveform modes (NTX numbering).
const (
	WfmDU   = 1   // fast 1-bit, mild ghosting — cursors, progress
	WfmGC16 = 2   // full quality 16-gray — page turns, stills
	WfmA2   = 4   // fastest 1-bit — keystroke feedback
	WfmAuto = 257 // let the EPDC choose
)

// Update modes.
const (
	UpdatePartial = 0
	UpdateFull    = 1 // full flash, clears ghosting
)

type Rect struct{ Top, Left, W, H uint32 }

type FB struct {
	f      *os.File
	Mem    []byte
	W, H   int // visible resolution
	Stride int // bytes per line
	BPP    int
	marker uint32
}

func ioctl(fd uintptr, req uintptr, arg unsafe.Pointer) error {
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, req, uintptr(arg))
	if errno != 0 {
		return errno
	}
	return nil
}

func Open() (*FB, error) {
	f, err := os.OpenFile("/dev/fb0", os.O_RDWR, 0)
	if err != nil {
		return nil, err
	}
	// fb_var_screeninfo: xres@0 yres@4 bpp@24 (u32 fields)
	var vinfo [40]uint32
	if err := ioctl(f.Fd(), fbioGetVScreenInfo, unsafe.Pointer(&vinfo)); err != nil {
		f.Close()
		return nil, fmt.Errorf("FBIOGET_VSCREENINFO: %w", err)
	}
	// fb_fix_screeninfo (arm32): smem_len@20 line_length@44 (u32)
	var finfo [80]byte
	if err := ioctl(f.Fd(), fbioGetFScreenInfo, unsafe.Pointer(&finfo)); err != nil {
		f.Close()
		return nil, fmt.Errorf("FBIOGET_FSCREENINFO: %w", err)
	}
	smemLen := *(*uint32)(unsafe.Pointer(&finfo[20]))
	stride := *(*uint32)(unsafe.Pointer(&finfo[44]))

	mem, err := syscall.Mmap(int(f.Fd()), 0, int(smemLen),
		syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_SHARED)
	if err != nil {
		f.Close()
		return nil, fmt.Errorf("mmap fb: %w", err)
	}
	return &FB{
		f: f, Mem: mem,
		W: int(vinfo[0]), H: int(vinfo[1]),
		Stride: int(stride), BPP: int(vinfo[6]),
	}, nil
}

func (fb *FB) Close() error {
	syscall.Munmap(fb.Mem)
	return fb.f.Close()
}

// Fill paints a rectangle in a single gray level (0 black .. 255 white).
func (fb *FB) Fill(r Rect, gray byte) {
	px := []byte{gray, gray, gray, 0xFF} // BGRA
	for y := r.Top; y < r.Top+r.H && int(y) < fb.H; y++ {
		row := int(y) * fb.Stride
		for x := r.Left; x < r.Left+r.W && int(x) < fb.W; x++ {
			copy(fb.Mem[row+int(x)*4:], px)
		}
	}
}

// SetPixel writes one gray pixel; bounds-checked.
func (fb *FB) SetPixel(x, y int, gray byte) {
	if x < 0 || y < 0 || x >= fb.W || y >= fb.H {
		return
	}
	o := y*fb.Stride + x*4
	fb.Mem[o], fb.Mem[o+1], fb.Mem[o+2], fb.Mem[o+3] = gray, gray, gray, 0xFF
}

// Refresh asks the EPDC to push a region to glass. wait blocks until the
// panel is done (needed before overlapping updates).
func (fb *FB) Refresh(r Rect, waveform uint32, updateMode uint32, wait bool) error {
	fb.marker++
	// struct mxcfb_update_data v2 (72 bytes):
	// rect(16) wfm@16 mode@20 marker@24 temp@28 flags@32 dither@36 quant@40 alt(28)@44
	var u [18]uint32
	u[0], u[1], u[2], u[3] = r.Top, r.Left, r.W, r.H
	u[4] = waveform
	u[5] = updateMode
	u[6] = fb.marker
	u[7] = tempUseAmbient
	if err := ioctl(fb.f.Fd(), mxcfbSendUpdate, unsafe.Pointer(&u)); err != nil {
		return fmt.Errorf("MXCFB_SEND_UPDATE: %w", err)
	}
	if wait {
		md := [2]uint32{fb.marker, 0}
		if err := ioctl(fb.f.Fd(), mxcfbWaitForUpdateComplete, unsafe.Pointer(&md)); err != nil {
			return fmt.Errorf("MXCFB_WAIT_FOR_UPDATE_COMPLETE: %w", err)
		}
	}
	return nil
}

// Full is the whole visible screen.
func (fb *FB) Full() Rect { return Rect{0, 0, uint32(fb.W), uint32(fb.H)} }

// Clear paints the screen white and does a full flashing refresh.
func (fb *FB) Clear() error {
	fb.Fill(fb.Full(), 0xFF)
	return fb.Refresh(fb.Full(), WfmGC16, UpdateFull, true)
}
