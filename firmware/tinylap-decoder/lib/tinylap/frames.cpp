#include "frames.h"
#include <stdint.h>
#include "tinylap_ir.h"

namespace tinylap {

const FrameLimits kLimits = {100, 1593, 2400, 987, 1592, 590, 986, 200, 700, 15836, 2000, 800, 1700};

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
  // 16-bit where a level fits, to keep the frame small on the IR task's stack.
  uint32_t starts[512];
  uint16_t lens[512];
  uint16_t before[512];  // the high level before each burst; UINT16_MAX (silence) at the batch's start
  uint16_t after[512];   // the high level after it; UINT16_MAX (silence) at the batch's end
  size_t bursts = 0;
  uint32_t t = 0;
  for (size_t k = 0; k < n; k++) {
    if (levels[k].low && bursts < 512) {
      starts[bursts] = t;
      lens[bursts] = levels[k].us;
      before[bursts] = bursts == 0 ? UINT16_MAX : (k > 0 && !levels[k - 1].low ? levels[k - 1].us : 0);
      after[bursts] = k + 1 < n ? (!levels[k + 1].low ? levels[k + 1].us : 0) : UINT16_MAX;
      bursts++;
    }
    t += levels[k].us;
  }
  // A frame is bounded by silence (spec §5.1): nothing can sit closer to it than the longest pause
  // inside a frame. Two overlapping frames would otherwise hide a third id in their union.
  uint16_t silence = lim.silenceMin;

  size_t found = 0;
  size_t i = 0;
  // A frame is 10 bursts: the start, 8 bits (the 7-bit id LSB first, then even parity), the stop.
  while (i + 9 < bursts) {
    uint32_t sp = starts[i + 1] - starts[i];
    if (!within(sp, lim.startMin, lim.startMax)) { note(Reject::Start); i++; continue; }

    uint8_t bits = 0;
    bool ok = true;
    for (size_t k = i + 1; k <= i + 8; k++) {
      uint32_t p = starts[k + 1] - starts[k];
      uint8_t bit = uint8_t(k - i - 1);
      if (within(p, lim.oneMin, lim.oneMax)) bits |= uint8_t(1u << bit);
      else if (within(p, lim.zeroMin, lim.zeroMax)) { /* a 0 */ }
      else { note(Reject::Bit, bit); ok = false; break; }
    }
    if (!ok) { i++; continue; }

    ok = within(lens[i], lim.startBurstMin, lim.startBurstMax);
    for (size_t k = i + 1; ok && k <= i + 9; k++) ok = within(lens[k], lim.burstMin, lim.burstMax);
    if (!ok) { note(Reject::Burst); i++; continue; }

    if (before[i] < silence) { note(Reject::Start); i++; continue; }
    if (after[i + 9] < silence) { note(Reject::Stop); i++; continue; }

    if (starts[i + 9] + lens[i + 9] - starts[i] > lim.frameMax) { note(Reject::Long); i++; continue; }

    // Last, so a frame that fails anything else keeps that reason.
    uint8_t id = bits & 0x7F;
    if (tlParity(id) != bool(bits >> 7)) { note(Reject::Parity); i++; continue; }

    if (found < maxOut) out[found] = {id, starts[i]};
    found++;
    i += 10;
  }
  if (found > maxOut) found = maxOut;

  // Too few bursts left for a frame: a good start with no room for the rest is a missing stop.
  bool tailStart = false;
  for (size_t k = i; k + 1 < bursts; k++) {
    if (within(starts[k + 1] - starts[k], lim.startMin, lim.startMax)) { tailStart = true; break; }
  }
  if (tailStart) note(Reject::Stop);
  else if (bursts < 10) note(Reject::Short);
  return found;
}

int64_t batchStartUs(int64_t readUs, const Level* levels, size_t n, uint16_t idleUs) {
  int64_t sum = 0;
  for (size_t k = 0; k < n; k++) sum += levels[k].us;
  return readUs - sum - idleUs;
}

}  // namespace tinylap
