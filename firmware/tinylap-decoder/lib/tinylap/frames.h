#pragma once
#include <stddef.h>
#include <stdint.h>

namespace tinylap {

struct Level { bool low; uint16_t us; };  // low: carrier present (the TSOP pulls the line low)

struct FrameLimits {
  uint16_t glitchMax, startMin, startMax, oneMin, oneMax, zeroMin, zeroMax, burstMin, burstMax, frameMax;
  // The least high level around a frame (spec §5.1). Set from the capture's measured pauses inside
  // a frame (spec §4.3). 1550 (startMax - burstMin) is the safe default before any measurement; with it,
  // two transponders in view at once decode nothing, since their gaps sum to under 3.1 ms.
  uint16_t silenceMin;
};
extern const FrameLimits kLimits;  // the README's values (spec §5.1)

struct Frame { uint8_t id; uint32_t offsetUs; };  // offsetUs: the frame's first falling edge, from the batch's start

enum class Reject : uint8_t { None, Start, Bit, Stop, Short, Burst, Long };
struct Rejection { Reject why; uint8_t bit; };  // bit: 0-6, for Reject::Bit

// A level shorter than glitchMax (exclusive, unlike the inclusive period limits) is merged away.
// In place; returns the new count.
size_t filterGlitches(Level* levels, size_t n, uint16_t glitchMax);

// Returns the frames found; *first is the first rejection, or None.
size_t decodeBatch(const Level* levels, size_t n, const FrameLimits& limits,
                   Frame* out, size_t maxOut, Rejection* first);

// When the batch's first level began (spec §5.3).
int64_t batchStartUs(int64_t readUs, const Level* levels, size_t n, uint16_t idleUs);

}  // namespace tinylap
