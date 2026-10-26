#include "crossings.h"

namespace tinylap {

Crossings::Crossings(const CrossingParams& p, CrossingObserver* observer) : p_(p), observer_(observer) { reset(); }

void Crossings::reset() {
  for (Car& c : cars_) c = Car{};
}

// Milliseconds from a to b; negative if b is earlier.
static int64_t since(uint32_t a, uint32_t b) { return (int64_t)b - (int64_t)a; }

uint32_t Crossings::stampOf(const Car& c) const {
  return p_.stamp == Stamp::First ? c.firstMs : c.firstMs + (c.lastMs - c.firstMs) / 2;
}

void Crossings::emit(uint8_t id, Car& c, uint32_t stamp, Passing* out, size_t maxOut, size_t* n) {
  c.emitted = true;
  c.stampMs = stamp;
  c.passed = true;
  c.lastPassingMs = stamp;
  if (*n < maxOut) out[(*n)++] = Passing{id, stamp};
}

void Crossings::close(uint8_t id, Car& c, Passing* out, size_t maxOut, size_t* n) {
  if (!c.open) return;
  c.open = false;
  if (c.confirmed && !c.emitted) emit(id, c, stampOf(c), out, maxOut, n);
  if (!observer_) return;
  Outcome outcome = Outcome::Passed;
  if (!c.counts) {
    // Quiet is checked first: a car that kept being seen is the likelier reason.
    outcome = c.quietOk ? Outcome::MinLap : Outcome::Quiet;
  } else if (!c.confirmed) {
    outcome = Outcome::Single;
  }
  observer_->ended(CrossingEnd{id, outcome, c.firstMs, c.lastMs, c.emitted ? c.stampMs : stampOf(c), c.frames});
}

size_t Crossings::onFrame(uint8_t id, uint32_t t, Passing* out, size_t maxOut) {
  size_t n = 0;
  Car& c = cars_[id & 127];
  if (c.open && since(c.lastMs, t) >= (int64_t)p_.gapMs) {
    // The old crossing ended before this frame. Its end is recorded against the car's last frame.
    close(id, c, out, maxOut, &n);
  }
  if (!c.open) {
    // "Never seen" and "never passed" are flags, not time 0, so a car at the start of a boot counts (spec §5.2).
    bool quietOk = !c.seen || since(c.lastSeenMs, t) >= (int64_t)p_.quietMs;
    bool lapOk = !c.passed || since(c.lastPassingMs, t) >= (int64_t)p_.minLapMs;
    c.open = true;
    c.quietOk = quietOk;
    c.counts = quietOk && lapOk;
    c.confirmed = false;
    c.emitted = false;
    c.frames = 0;
    c.firstMs = t;
    c.stampMs = 0;
  }
  if (c.frames < UINT16_MAX) c.frames++;
  c.lastMs = t;
  c.seen = true;
  c.lastSeenMs = t;
  if (c.counts) {
    if (!c.confirmed && c.frames >= p_.confirmFrames) {
      c.confirmed = true;
      if (p_.stamp == Stamp::First) emit(id, c, c.firstMs, out, maxOut, &n);
    }
    if (c.confirmed && !c.emitted && since(c.firstMs, t) >= (int64_t)p_.maxCrossingMs) {
      emit(id, c, stampOf(c), out, maxOut, &n);
    }
  }
  return n;
}

size_t Crossings::tick(uint32_t nowMs, Passing* out, size_t maxOut) {
  size_t n = 0;
  for (int i = 0; i < 128; i++) {
    Car& c = cars_[i];
    if (!c.open) continue;
    if (since(c.lastMs, nowMs) >= (int64_t)p_.gapMs) {
      close((uint8_t)i, c, out, maxOut, &n);
    } else if (c.confirmed && !c.emitted && since(c.firstMs, nowMs) >= (int64_t)p_.maxCrossingMs) {
      emit((uint8_t)i, c, stampOf(c), out, maxOut, &n);
    }
  }
  return n;
}

bool toBootMs(int64_t frameUs, int64_t bootStartUs, uint32_t* outMs) {
  if (frameUs < bootStartUs) return false;
  *outMs = (uint32_t)((frameUs - bootStartUs) / 1000);
  return true;
}

}  // namespace tinylap
