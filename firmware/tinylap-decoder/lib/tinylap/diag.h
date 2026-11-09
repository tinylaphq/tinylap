#pragma once
#include <stdint.h>
#include <string>
#include "crossings.h"

namespace tinylap {

// The decoder's counters (spec §6.1). They run from power-up and never reset.
// All uint32_t, so there is no padding and the checksum reads no uninitialised bytes.
struct Counters {
  uint32_t batches, frames, rejStart, rejBit, rejStop, rejShort, rejBurst, rejLong,
      rejParity, overflow, ringlow, qdrop, pass, single, quiet, minlap, rxdrop, suppressed;
};
constexpr uint32_t kCounterCount = sizeof(Counters) / sizeof(uint32_t);
static_assert(sizeof(Counters) == kCounterCount * sizeof(uint32_t), "Counters must have no padding");

// The longest firmware version a boot line carries; with every counter at its maximum the line stays
// under 512 bytes (spec §6.1).
constexpr size_t kFwMax = 32;

// What the stat line says about Wi-Fi delivery (Wi-Fi spec §3.5). post is the last answer's status,
// 0 for no connection or a timeout (post=err), negative before the first answer (no post).
struct NetStats { const char* net; uint32_t outbox, odrop; int post; };

// Every line is `%TLLOG <kind> key=value ...&`; values hold no space, % or &.
// prev may be null (nothing survived the reset); net may be null (no net fields).
std::string bootLine(const char* reason, const char* fw, const Counters* prev);
std::string statLine(const Counters& c, uint32_t upS, uint32_t heap, const NetStats* net = nullptr);
// rssi= when connected, reason= (the ESP-IDF disconnect reason) otherwise; never the SSID (Wi-Fi spec §3.5).
std::string wifiLine(const char* state, int rssi, int reason);
std::string passLine(const CrossingEnd& e);   // Outcome::Passed only
std::string eventLine(const CrossingEnd& e);  // Single, Quiet, MinLap
std::string overflowLine(uint32_t tMs);

// At most 20 event lines per 10 s window (spec §6.1). The caller counts the rest in suppressed.
class EventLimit {
 public:
  bool allow(uint32_t nowMs);

 private:
  bool open_ = false;
  uint32_t startMs_ = 0;
  uint8_t used_ = 0;
};

// Lives in RTC_NOINIT memory on the board, so the last counters survive a crash.
// Counters saved by a build with another counter set fail the checksum, so restore reports nothing
// after a reflash.
struct Saved { uint32_t magic; Counters c; uint32_t sum; };
void save(Saved& s, const Counters& c);
bool restore(const Saved& s, Counters& out);  // false unless magic and sum match

}  // namespace tinylap
