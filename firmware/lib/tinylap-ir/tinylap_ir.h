#pragma once
#include <stddef.h>
#include <stdint.h>

// The TinyLap IR frame, in cycles of the 38 kHz carrier (spec §3.1). Both the transponder and the decoder
// take their numbers from here.
//
// A frame is TL_LEVELS levels, a burst first, then alternating pause and burst: the start burst and pause,
// then per bit (id bit 0 first, then bit 7 = even parity over the 7-bit id) a burst and a pause, then the
// stop burst. A bit is told by its pause alone.
constexpr uint32_t TL_CARRIER_HZ = 38000;
constexpr uint8_t TL_START_BURST = 46, TL_START_PAUSE = 30, TL_BURST = 15, TL_ZERO_PAUSE = 15, TL_ONE_PAUSE = 30,
                  TL_BITS = 8;
constexpr uint8_t TL_LEVELS = 19;  // start burst, start pause, 8 x (burst, pause), stop burst
// The pause between two frames of one transponder, in microseconds.
constexpr uint16_t TL_GAP_MIN_US = 12000, TL_GAP_MAX_US = 28000;

// Carrier cycles to microseconds, rounded to the nearest.
uint32_t tlCyclesToUs(uint16_t cycles);

// The even-parity bit for a 7-bit id: true when the id has an odd number of ones.
bool tlParity(uint8_t id);

// Writes the frame's TL_LEVELS levels in cycles and returns TL_LEVELS. Returns 0 for an id above 127 or room
// for fewer than TL_LEVELS.
size_t tlEncodeFrame(uint8_t id, uint16_t* levelsCycles, size_t max);
