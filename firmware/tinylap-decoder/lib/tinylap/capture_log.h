#pragma once
#include <stddef.h>
#include <stdint.h>
#include <map>
#include <string>
#include "frames.h"

namespace tinylap {

// One log line for a batch (spec §4.1). `raw` is the levels as the RMT gave them.
// With no frames, `first` says why: `id=?` and the reason.
std::string formatBatch(int64_t startUs, const Level* raw, size_t n, const Frame* frames, size_t nFrames,
                        Rejection first);

// The counters behind the 5-second summary line (spec §4.1).
class CaptureStats {
 public:
  void add(int64_t startUs, const Frame* frames, size_t nFrames);  // frame times: startUs + offsetUs
  void overflowed();                                              // a batch that filled the RMT's memory
  std::string summary(size_t ringLowWater);                       // and resets the counters

 private:
  struct PerId {
    uint32_t frames = 0;
    bool hasLast = false;
    int64_t lastUs = 0;
    uint32_t gaps = 0;
    int64_t minGap = 0, maxGap = 0;
    double sum = 0, sumSq = 0;
  };
  uint32_t batches_ = 0;
  uint32_t overflows_ = 0;
  std::map<uint8_t, PerId> ids_;  // ascending by id
};

}  // namespace tinylap
