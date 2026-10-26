#pragma once
#include <stddef.h>
#include <stdint.h>

namespace tinylap {

enum class Stamp : uint8_t { First, Middle };

struct CrossingParams {
  uint32_t gapMs = 150, quietMs = 500, minLapMs = 2000, maxCrossingMs = 500;
  uint8_t confirmFrames = 2;
  Stamp stamp = Stamp::Middle;
};

struct Passing { uint8_t id; uint32_t tMs; };

// How a crossing ended (spec §5.2, §6.1). Single: fewer than confirmFrames frames.
enum class Outcome : uint8_t { Passed, Single, Quiet, MinLap };

struct CrossingEnd { uint8_t id; Outcome outcome; uint32_t firstMs, lastMs, stampMs; uint16_t frames; };

struct CrossingObserver {
  virtual void ended(const CrossingEnd& e) = 0;
  virtual ~CrossingObserver() = default;
};

// Turns the frames of each car into one passing per crossing (spec §5.2). Fixed arrays, no allocation.
class Crossings {
 public:
  explicit Crossings(const CrossingParams& p = {}, CrossingObserver* observer = nullptr);
  // Frames come in time order. Both calls write the passings that are ready to out; any beyond maxOut are dropped.
  size_t onFrame(uint8_t id, uint32_t tMs, Passing* out, size_t maxOut);
  // Closes crossings past gapMs and caps open ones at maxCrossingMs.
  size_t tick(uint32_t nowMs, Passing* out, size_t maxOut);
  // A new boot: every crossing, last passing and last-seen time is cleared, nothing is reported (spec §5.2).
  void reset();

 private:
  struct Car {
    bool open, quietOk, counts, confirmed, emitted;
    uint16_t frames;
    uint32_t firstMs, lastMs, stampMs;
    bool seen;  uint32_t lastSeenMs;
    bool passed;  uint32_t lastPassingMs;
  };
  uint32_t stampOf(const Car& c) const;
  void emit(uint8_t id, Car& c, uint32_t stamp, Passing* out, size_t maxOut, size_t* n);
  void close(uint8_t id, Car& c, Passing* out, size_t maxOut, size_t* n);

  CrossingParams p_;
  CrossingObserver* observer_;
  Car cars_[128];
};

// A frame's time on the boot's clock; false for a frame from before the boot (spec §2.4).
bool toBootMs(int64_t frameUs, int64_t bootStartUs, uint32_t* outMs);

}  // namespace tinylap
