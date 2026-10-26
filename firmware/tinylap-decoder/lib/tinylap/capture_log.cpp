#include "capture_log.h"
#include <inttypes.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>

namespace tinylap {

static std::string fmt(const char* f, ...) __attribute__((format(printf, 1, 2)));
static std::string fmt(const char* f, ...) {
  char buf[64];
  va_list ap;
  va_start(ap, f);
  vsnprintf(buf, sizeof buf, f, ap);
  va_end(ap);
  return buf;
}

std::string formatBatch(int64_t startUs, const Level* raw, size_t n, const Frame* frames, size_t nFrames,
                        Rejection first) {
  std::string s = fmt("F t=%" PRId64 " n=%u", startUs, unsigned(n));
  uint32_t total = 0;
  for (size_t i = 0; i < n; i++) {
    s += fmt(" %c%u", raw[i].low ? 'L' : 'H', unsigned(raw[i].us));
    total += raw[i].us;
  }
  s += fmt(" d=%u id=", unsigned(total));
  if (nFrames > 0) {
    for (size_t i = 0; i < nFrames; i++) s += fmt(i ? ",%u" : "%u", unsigned(frames[i].id));
    return s;
  }
  s += '?';
  switch (first.why) {
    case Reject::Start: s += " start"; break;
    case Reject::Bit: s += fmt(" bit %u", unsigned(first.bit)); break;
    case Reject::Stop: s += " stop"; break;
    case Reject::Short: s += " short"; break;
    case Reject::Burst: s += " burst"; break;
    case Reject::Long: s += " long"; break;
    case Reject::None: break;
  }
  return s;
}

void CaptureStats::add(int64_t startUs, const Frame* frames, size_t nFrames) {
  batches_++;
  for (size_t i = 0; i < nFrames; i++) {
    PerId& p = ids_[frames[i].id];
    int64_t t = startUs + frames[i].offsetUs;
    p.frames++;
    if (p.hasLast) {
      int64_t gap = t - p.lastUs;
      if (p.gaps == 0 || gap < p.minGap) p.minGap = gap;
      if (p.gaps == 0 || gap > p.maxGap) p.maxGap = gap;
      p.gaps++;
      p.sum += double(gap);
      p.sumSq += double(gap) * double(gap);
    }
    p.hasLast = true;
    p.lastUs = t;
  }
}

void CaptureStats::overflowed() { overflows_++; }

std::string CaptureStats::summary(size_t ringLowWater) {
  std::string s = fmt("S batches=%u overflow=%u ringlow=%u", unsigned(batches_), unsigned(overflows_),
                      unsigned(ringLowWater));
  for (const auto& kv : ids_) {
    const PerId& p = kv.second;
    s += fmt(" id=%u frames=%u", unsigned(kv.first), unsigned(p.frames));
    if (p.gaps == 0) continue;
    double mean = p.sum / p.gaps;
    double var = p.sumSq / p.gaps - mean * mean;
    s += fmt(" gap=%" PRId64 "..%" PRId64 " mean=%.0f sd=%.0f", p.minGap, p.maxGap, mean,
             var > 0 ? sqrt(var) : 0.0);
  }
  batches_ = 0;
  overflows_ = 0;
  ids_.clear();
  return s;
}

}  // namespace tinylap
