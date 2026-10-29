#pragma once
#include <stddef.h>
#include <stdint.h>
#include "frames.h"

namespace ir {

constexpr size_t kMaxLevels = 512;  // 4 memory blocks (spec §5.3)
constexpr uint16_t kIdleUs = 2500;  // the silence that ends a batch (spec §5.3)

struct Batch {
  int64_t readUs;  // esp_timer_get_time(), right after the receive
  size_t n;
  tinylap::Level levels[kMaxLevels];
};

// RMT receiver on `pin`: channel 0, 4 blocks, 1 µs ticks, the hardware glitch filter at its
// maximum, idle kIdleUs, an 8 KB ring buffer (spec §5.3).
bool begin(int pin);

// One batch, as levels (RMT level 0 is low, carrier present). False on timeout, or when begin() failed.
// waitMs portMAX_DELAY waits for ever.
bool receive(Batch& out, uint32_t waitMs);

// The least free space the ring buffer has had, in bytes. The legacy driver drops a batch
// on a full ring buffer without telling us; a value near 0 is the sign.
size_t ringLowWater();

}  // namespace ir
