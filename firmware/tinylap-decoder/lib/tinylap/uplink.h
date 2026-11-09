#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string>
#include <utility>
#include <vector>

namespace tinylap {

struct UplinkConfig { std::string server, decoder, token; };   // empty server or decoder: send nothing
struct Request { std::string url, auth, body; };                 // auth is "Bearer <token>"
enum class NetState : uint8_t { Off, Connecting, Connected, Paused };

// The outbox and what to post when (spec §3.3, §3.4); the glue does the HTTP and the clock.
class Uplink {
 public:
  static constexpr size_t kCapacity = 2000, kMaxBatch = 500;
  static constexpr int64_t kInUseUs = 15LL * 60 * 1000000, kBackoffMinUs = 1000000, kBackoffMaxUs = 30000000;
  void configure(const UplinkConfig& c);                  // a new token ends a 401 pause
  void onBoot(const std::string& boot, int64_t bootStartUs);
  void onPassing(const std::string& transponder, uint32_t tMs, int64_t nowUs);  // restarts the in-use window
  void onConnected(int64_t nowUs);                         // restarts the in-use window
  void onStat(const std::string& logLine, int64_t nowUs);  // the 10 s heartbeat; logLine is the text after "%TLLOG " without "&"
  void onBootLine(const std::string& logLine);             // sent with the next batch
  bool next(int64_t nowUs, Request& out);                  // false: nothing due, a request in flight, backing off or paused
  void answer(int status, const std::string& body, int64_t nowUs, int64_t retryAfterS = 0);  // status 0: no connection or timeout
  size_t waiting() const { return count_; }
  uint32_t dropped() const { return dropped_; }   // passings dropped as full, or with a fifth boot
  int lastStatus() const { return lastStatus_; }  // -1 before the first answer, 0 for no connection or timeout
  bool paused() const { return paused_; }

 private:
  struct Entry { uint8_t boot; uint32_t t; char transponder[5]; };
  struct Boot { uint8_t seq; std::string id; };
  static constexpr size_t kBoots = 4;
  static constexpr size_t kMaxLogBytes = 510;        // the server's limit per log line (docs/timing.md)
  static constexpr int64_t kMaxRetryAfterS = 3600;   // a longer Retry-After is taken as an hour

  Entry& at(size_t i) { return ring_[(head_ + i) % kCapacity]; }
  void dropFront();
  const std::string* bootId(uint8_t seq) const;
  void startInUse(int64_t nowUs);
  bool inUse(int64_t nowUs) const { return everInUse_ && nowUs < inUseUntilUs_; }

  UplinkConfig config_;
  std::vector<Entry> ring_ = std::vector<Entry>(kCapacity);   // the oldest at head_
  size_t head_ = 0, count_ = 0;
  std::vector<Boot> boots_;   // the oldest first, the current boot last
  uint8_t nextSeq_ = 0;
  int64_t bootStartUs_ = 0;
  uint32_t dropped_ = 0;

  // The request in flight: it carried the first sent_ entries (a batch is always the ring's front).
  bool inFlight_ = false, sentQuiet_ = false;
  size_t sent_ = 0;
  uint32_t sentBootLineGen_ = 0, sentStatGen_ = 0;   // which log lines it carried, 0 for none

  std::string bootLine_, stat_;                  // stat_: the latest stat line
  bool bootLinePending_ = false, statPending_ = false;
  uint32_t bootLineGen_ = 0, statGen_ = 0;
  int64_t inUseUntilUs_ = 0;
  bool everInUse_ = false, heartbeatDue_ = false, quietDue_ = false, quietSent_ = false;

  bool paused_ = false;
  int64_t waitUntilUs_ = 0, backoffUs_ = kBackoffMinUs;
  int lastStatus_ = -1;
};

// The body of POST /decoders/<id>/passings (docs/timing.md); nowMs null leaves "now" out.
std::string batchBody(const std::string& boot, const std::vector<std::pair<std::string, uint32_t>>& passings,
                      const std::vector<std::string>& logs, const int64_t* nowMs, bool quiet);  // JSON; escapes " and \ in log lines
bool readThrough(const std::string& body, int64_t& through);  // false when "through" is null or missing

}  // namespace tinylap
