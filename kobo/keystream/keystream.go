// Package keystream is the wire format for streaming keyboard events from
// the NUC to the Kobo over UDP: 5-byte key datagrams plus 1-byte keepalives
// (the keepalive keeps the Kobo's Realtek radio out of power-save, which
// otherwise adds a 50–100 ms wake spike to the first packet after a pause).
package keystream

// Port is the UDP port kbnet listens on and kbforward sends to.
const Port = 7768

// Key event values, matching evdev.
const (
	Up     = 0
	Down   = 1
	Repeat = 2
)

// Event is one key transition. Seq wraps at 256; the receiver uses gaps to
// detect dropped datagrams.
type Event struct {
	Code  uint16 // evdev KEY_* code
	Value uint8  // Up, Down, Repeat
	Seq   uint8
}

// Keepalive is the radio-warming datagram, sent every ~100 ms while idle.
var Keepalive = []byte{'P'}

// Encode packs an Event into a datagram.
func Encode(e Event) []byte {
	return []byte{'K', byte(e.Code), byte(e.Code >> 8), e.Value, e.Seq}
}

// Decode unpacks a datagram. ok is false for keepalives and anything malformed.
func Decode(b []byte) (e Event, ok bool) {
	if len(b) != 5 || b[0] != 'K' {
		return Event{}, false
	}
	return Event{
		Code:  uint16(b[1]) | uint16(b[2])<<8,
		Value: b[3],
		Seq:   b[4],
	}, true
}
