#pragma once
#include <stdint.h>

// The transponder's logic, free of hardware so it runs on the host (spec §4).

// True when the EEPROM's id is usable: at most 127 and followed by its complement.
bool tlIdValid(uint8_t id, uint8_t complement);

// The starting state of the random gaps for an id; never 0, so tlXorshift never gets stuck.
uint16_t tlSeed(uint8_t id);

// One xorshift16 step (7, 9, 8): advances the state and returns it. Never 0 from a non-zero state.
uint16_t tlXorshift(uint16_t& state);

// The next pause between two frames in microseconds, evenly from TL_GAP_MIN_US to TL_GAP_MAX_US.
uint16_t tlNextGapUs(uint16_t& state);
