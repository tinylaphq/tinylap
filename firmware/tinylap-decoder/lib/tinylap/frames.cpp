#include "frames.h"
#include <stdint.h>

namespace tinylap {

const FrameLimits kLimits = {100, 1100, 1700, 751, 1100, 421, 750, 150, 1200, 9000};

size_t filterGlitches(Level* levels, size_t n, uint16_t glitchMax) {
  size_t w = 0;  // write index
  size_t r = 0;
  while (r < n) {
    if (levels[r].us >= glitchMax) {
      levels[w++] = levels[r++];
      continue;
    }
    // A short level joins both neighbours, or its one neighbour at an end.
    if (w > 0 && r + 1 < n) {
      uint32_t sum = uint32_t(levels[w - 1].us) + levels[r].us + levels[r + 1].us;
      levels[w - 1].us = sum > 65535 ? 65535 : uint16_t(sum);
      r += 2;
    } else if (w > 0) {
      uint32_t sum = uint32_t(levels[w - 1].us) + levels[r].us;
      levels[w - 1].us = sum > 65535 ? 65535 : uint16_t(sum);
      r++;
    } else if (r + 1 < n) {
      uint32_t sum = uint32_t(levels[r + 1].us) + levels[r].us;
      levels[w] = levels[r + 1];
      levels[w].us = sum > 65535 ? 65535 : uint16_t(sum);
      w++;
      r += 2;
    } else {
      r++;  // a lone short level: nothing to join
    }
  }
  return w;
}

static bool within(uint32_t v, uint16_t lo, uint16_t hi) { return v >= lo && v <= hi; }

size_t decodeBatch(const Level* levels, size_t n, const FrameLimits& lim,
                   Frame* out, size_t maxOut, Rejection* first) {
  Rejection none = {Reject::None, 0};
  Rejection& rej = first ? *first : none;
  rej = {Reject::None, 0};
  auto note = [&](Reject why, uint8_t bit = 0) {
    if (rej.why == Reject::None) rej = {why, bit};
  };

  // Every low level's start (µs from the batch's start) and length. At most n of each.
  uint32_t starts[512];
  uint16_t lens[512];
  uint32_t before[512];  // the high level before each burst; UINT32_MAX at the batch's start
  uint32_t after[512];   // the high level after it; UINT32_MAX at the batch's end
  size_t bursts = 0;
  uint32_t t = 0;
  for (size_t k = 0; k < n; k++) {
    if (levels[k].low && bursts < 512) {
      starts[bursts] = t;
      lens[bursts] = levels[k].us;
      before[bursts] = bursts == 0 ? UINT32_MAX : (k > 0 && !levels[k - 1].low ? levels[k - 1].us : 0);
      after[bursts] = k + 1 < n ? (!levels[k + 1].low ? levels[k + 1].us : 0) : UINT32_MAX;
      bursts++;
    }
    t += levels[k].us;
  }
  // A frame is bounded by silence (spec §5.1): nothing can sit closer to it than the longest pause
  // inside a frame. Two overlapping frames would otherwise hide a third id in their union.
  uint32_t silence = uint32_t(lim.startMax) - lim.burstMin;

  size_t found = 0;
  size_t i = 0;
  while (i + 8 < bursts) {
    uint32_t sp = starts[i + 1] - starts[i];
    if (!within(sp, lim.startMin, lim.startMax)) { note(Reject::Start); i++; continue; }

    uint8_t id = 0;
    bool ok = true;
    for (size_t k = i + 1; k <= i + 7; k++) {
      uint32_t p = starts[k + 1] - starts[k];
      uint8_t bit = uint8_t(k - i - 1);
      if (within(p, lim.oneMin, lim.oneMax)) id |= uint8_t(1u << bit);
      else if (within(p, lim.zeroMin, lim.zeroMax)) { /* a 0 */ }
      else { note(Reject::Bit, bit); ok = false; break; }
    }
    if (!ok) { i++; continue; }

    for (size_t k = i; k <= i + 8; k++) {
      if (!within(lens[k], lim.burstMin, lim.burstMax)) { ok = false; break; }
    }
    if (!ok) { note(Reject::Burst); i++; continue; }

    if (before[i] < silence) { note(Reject::Start); i++; continue; }
    if (after[i + 8] < silence) { note(Reject::Stop); i++; continue; }

    if (starts[i + 8] + lens[i + 8] - starts[i] > lim.frameMax) { note(Reject::Long); i++; continue; }

    if (found < maxOut) out[found] = {id, starts[i]};
    found++;
    i += 9;
  }
  if (found > maxOut) found = maxOut;

  // Too few bursts left for a frame: a good start with no room for the rest is a missing stop.
  bool tailStart = false;
  for (size_t k = i; k + 1 < bursts; k++) {
    if (within(starts[k + 1] - starts[k], lim.startMin, lim.startMax)) { tailStart = true; break; }
  }
  if (tailStart) note(Reject::Stop);
  else if (bursts < 9) note(Reject::Short);
  return found;
}

int64_t batchStartUs(int64_t readUs, const Level* levels, size_t n, uint16_t idleUs) {
  int64_t sum = 0;
  for (size_t k = 0; k < n; k++) sum += levels[k].us;
  return readUs - sum - idleUs;
}

}  // namespace tinylap
