#include "uplink.h"
#include <algorithm>
#include <cstdio>
#include <cstring>

namespace tinylap {

void Uplink::configure(const UplinkConfig& c) {
  if (c.token != config_.token) paused_ = false;
  config_ = c;
}

// Up to four boots are kept; a fifth drops the oldest one's passings (spec §3.3).
void Uplink::onBoot(const std::string& boot, int64_t bootStartUs) {
  bootStartUs_ = bootStartUs;
  if (!boots_.empty() && boots_.back().id == boot) return;
  for (size_t b = boots_.size(); b-- > 0;) {
    bool held = false;
    for (size_t i = 0; i < count_ && !held; i++) held = at(i).boot == boots_[b].seq;
    if (!held) boots_.erase(boots_.begin() + b);
  }
  boots_.push_back({nextSeq_++, boot});
  while (boots_.size() > kBoots) {
    while (count_ > 0 && at(0).boot == boots_.front().seq) {
      dropFront();
      dropped_++;
    }
    boots_.erase(boots_.begin());
  }
}

void Uplink::dropFront() {
  head_ = (head_ + 1) % kCapacity;
  count_--;
  if (sent_ > 0) sent_--;
}

const std::string* Uplink::bootId(uint8_t seq) const {
  for (const Boot& b : boots_)
    if (b.seq == seq) return &b.id;
  return nullptr;
}

// When full, the oldest is dropped and counted (spec §3.3). Before any boot there is nothing to tag it with.
void Uplink::onPassing(const std::string& transponder, uint32_t tMs, int64_t nowUs) {
  if (boots_.empty()) return;
  if (count_ == kCapacity) {
    dropFront();
    dropped_++;
  }
  Entry& e = at(count_++);
  e.boot = boots_.back().seq;
  e.t = tMs;
  std::memset(e.transponder, 0, sizeof e.transponder);
  std::strncpy(e.transponder, transponder.c_str(), sizeof e.transponder - 1);
  startInUse(nowUs);
}

void Uplink::onConnected(int64_t nowUs) { startInUse(nowUs); }

// In use for 15 minutes after connecting and after each passing (spec §3.4).
void Uplink::startInUse(int64_t nowUs) {
  inUseUntilUs_ = nowUs + kInUseUs;
  everInUse_ = true;
  quietSent_ = quietDue_ = false;
}

// A heartbeat while in use; the first stat after that says quiet once (spec §3.4, §5).
void Uplink::onStat(const std::string& logLine, int64_t nowUs) {
  stat_ = logLine;
  statPending_ = true;
  statGen_++;
  if (inUse(nowUs)) heartbeatDue_ = true;
  else if (everInUse_ && !quietSent_) quietDue_ = true;
}

void Uplink::onBootLine(const std::string& logLine) {
  bootLine_ = logLine;
  bootLinePending_ = true;
  bootLineGen_++;
}

// A batch is one boot, the oldest first, at most 500 passings (spec §3.3, §3.4).
bool Uplink::next(int64_t nowUs, Request& out) {
  if (config_.server.empty() || config_.decoder.empty() || inFlight_ || paused_ || nowUs < waitUntilUs_) return false;
  if (count_ == 0 && !heartbeatDue_ && !quietDue_) return false;
  if (boots_.empty()) return false;

  std::vector<std::pair<std::string, uint32_t>> passings;
  uint8_t seq = count_ > 0 ? at(0).boot : boots_.back().seq;
  for (size_t i = 0; i < count_ && passings.size() < kMaxBatch && at(i).boot == seq; i++)
    passings.emplace_back(at(i).transponder, at(i).t);
  bool quiet = passings.empty() && quietDue_;

  // A batch of logs alone always carries the stat line: the server refuses an empty batch.
  std::vector<std::string> logs;
  if (bootLinePending_) logs.push_back(bootLine_);
  if (!stat_.empty() && (statPending_ || passings.empty())) logs.push_back(stat_);
  if (passings.empty() && logs.empty()) {
    heartbeatDue_ = quietDue_ = false;
    return false;
  }

  // "now" is on the current boot's clock, so only that boot's batches carry it (spec §5).
  const bool current = seq == boots_.back().seq && nowUs >= bootStartUs_;
  const int64_t nowMs = (nowUs - bootStartUs_) / 1000;
  std::string server = config_.server;
  while (!server.empty() && server.back() == '/') server.pop_back();
  out.url = server + "/decoders/" + config_.decoder + "/passings";
  out.auth = "Bearer " + config_.token;
  out.body = batchBody(*bootId(seq), passings, logs, current ? &nowMs : nullptr, quiet);

  inFlight_ = true;
  sent_ = passings.size();
  sentQuiet_ = quiet;
  sentBootLineGen_ = bootLinePending_ ? bootLineGen_ : 0;
  sentStatGen_ = !stat_.empty() && (statPending_ || passings.empty()) ? statGen_ : 0;
  heartbeatDue_ = quietDue_ = false;
  if (quiet) quietSent_ = true;
  return true;
}

// Answers as docs/timing.md and spec §3.4 say.
void Uplink::answer(int status, const std::string& body, int64_t nowUs, int64_t retryAfterS) {
  if (!inFlight_) return;
  inFlight_ = false;
  lastStatus_ = status;
  bool delivered = false;
  if (status == 200) {
    int64_t through;
    if (readThrough(body, through)) {   // drop only what this batch carried and through covers
      size_t gone = sent_;   // the kept ones close up toward the batch's end, the front gaps go
      for (size_t i = sent_; i-- > 0;)
        if (at(i).t > through) at(--gone) = at(i);
      head_ = (head_ + gone) % kCapacity;
      count_ -= gone;
    }
    backoffUs_ = kBackoffMinUs;
    delivered = true;
  } else if (status == 401) {
    paused_ = true;
  } else if (status == 404 || status == 422) {
    head_ = (head_ + sent_) % kCapacity;   // never taken: drop that batch's passings
    count_ -= sent_;
    delivered = true;
  } else if (status == 429 && retryAfterS > 0) {
    waitUntilUs_ = nowUs + retryAfterS * 1000000;
  } else {
    waitUntilUs_ = nowUs + backoffUs_;
    backoffUs_ = std::min(backoffUs_ * 2, kBackoffMaxUs);
  }
  if (delivered) {
    if (sentBootLineGen_ == bootLineGen_) bootLinePending_ = false;
    if (sentStatGen_ == statGen_) statPending_ = false;
  } else if (sentQuiet_ && !inUse(nowUs)) {
    quietSent_ = false;   // the quiet batch didn't arrive; send it again
    quietDue_ = true;
  }
  sent_ = 0;
}

static void appendString(std::string& o, const std::string& s) {
  o += '"';
  for (char c : s) {
    if (c == '"' || c == '\\') {
      o += '\\';
      o += c;
    } else if ((unsigned char)c < 0x20) {
      char u[7];
      std::snprintf(u, sizeof u, "\\u%04x", (unsigned char)c);
      o += u;
    } else {
      o += c;
    }
  }
  o += '"';
}

std::string batchBody(const std::string& boot, const std::vector<std::pair<std::string, uint32_t>>& passings,
                      const std::vector<std::string>& logs, const int64_t* nowMs, bool quiet) {
  std::string o = "{\"boot\":";
  appendString(o, boot);
  o += ",\"passings\":[";
  for (size_t i = 0; i < passings.size(); i++) {
    if (i) o += ',';
    o += "{\"transponder\":";
    appendString(o, passings[i].first);
    o += ",\"t\":" + std::to_string(passings[i].second) + "}";
  }
  o += ']';
  if (!logs.empty()) {
    o += ",\"logs\":[";
    for (size_t i = 0; i < logs.size(); i++) {
      if (i) o += ',';
      appendString(o, logs[i]);
    }
    o += ']';
  }
  if (nowMs) o += ",\"now\":" + std::to_string(*nowMs);
  if (quiet) o += ",\"quiet\":true";
  o += '}';
  return o;
}

bool readThrough(const std::string& body, int64_t& through) {
  size_t i = body.find("\"through\"");
  if (i == std::string::npos) return false;
  i += 9;
  while (i < body.size() && body[i] == ' ') i++;
  if (i >= body.size() || body[i++] != ':') return false;
  while (i < body.size() && body[i] == ' ') i++;
  size_t start = i;
  int64_t v = 0;
  for (; i < body.size() && body[i] >= '0' && body[i] <= '9' && i - start < 18; i++) v = v * 10 + (body[i] - '0');
  if (i == start) return false;
  through = v;
  return true;
}

}  // namespace tinylap
