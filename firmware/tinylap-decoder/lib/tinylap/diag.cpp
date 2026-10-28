#include "diag.h"
#include <string.h>
#include "zround.h"

namespace tinylap {
namespace {

const char* const kKeys[kCounterCount] = {"batches", "frames", "rej.start", "rej.bit", "rej.stop", "rej.short",
                               "rej.burst", "rej.long", "rej.parity", "overflow", "ringlow",
                               "qdrop", "pass", "single", "quiet", "minlap", "rxdrop", "suppressed"};
const uint32_t kMagic = 0x544C4C47;  // "TLLG"
const uint32_t kWindowMs = 10000;
const uint8_t kPerWindow = 20;

// Free text goes in a value: no space, % or & (spec §6.1).
std::string clean(const char* s) {
  std::string out = s ? s : "";
  for (char& ch : out)
    if (ch == ' ' || ch == '%' || ch == '&') ch = '_';
  return out;
}

std::string hex(uint32_t v) {
  const char* d = "0123456789ABCDEF";
  std::string s;
  do { s.insert(s.begin(), d[v & 15]); v >>= 4; } while (v);
  return s;
}

void counters(std::string& out, const Counters& c, const char* prefix) {
  const uint32_t* p = reinterpret_cast<const uint32_t*>(&c);
  for (uint32_t i = 0; i < kCounterCount; i++) out += std::string(" ") + prefix + kKeys[i] + "=" + std::to_string(p[i]);
}

uint32_t fnv1a(const void* data, size_t n) {
  const uint8_t* b = static_cast<const uint8_t*>(data);
  uint32_t h = 2166136261u;
  for (size_t i = 0; i < n; i++) { h ^= b[i]; h *= 16777619u; }
  return h;
}

}  // namespace

std::string bootLine(const char* reason, const char* fw, const Counters* prev) {
  std::string s = "%TLLOG boot reason=" + clean(reason) + " fw=" + clean(fw);
  if (prev) counters(s, *prev, "prev.");
  return s + "&";
}

std::string statLine(const Counters& c, uint32_t upS, uint32_t heap) {
  std::string s = "%TLLOG stat up=" + std::to_string(upS);
  counters(s, c, "");
  return s + " heap=" + std::to_string(heap) + "&";
}

std::string passLine(const CrossingEnd& e) {
  return "%TLLOG pass id=" + line::transponder(e.id) + " t=" + hex(e.stampMs) + " first=" + hex(e.firstMs) +
         " last=" + hex(e.lastMs) + " frames=" + std::to_string(e.frames) + "&";
}

std::string eventLine(const CrossingEnd& e) {
  const char* what = e.outcome == Outcome::Single ? "single" : e.outcome == Outcome::Quiet ? "quiet" : "minlap";
  return std::string("%TLLOG event what=") + what + " id=" + line::transponder(e.id) + " t=" + hex(e.firstMs) + "&";
}

std::string overflowLine(uint32_t tMs) { return "%TLLOG event what=overflow t=" + hex(tMs) + "&"; }

bool EventLimit::allow(uint32_t nowMs) {
  if (!open_ || nowMs - startMs_ >= kWindowMs) {
    open_ = true;
    startMs_ = nowMs;
    used_ = 0;
  }
  if (used_ >= kPerWindow) return false;
  used_++;
  return true;
}

void save(Saved& s, const Counters& c) {
  s.magic = kMagic;
  s.c = c;
  s.sum = fnv1a(&s.c, sizeof s.c);
}

bool restore(const Saved& s, Counters& out) {
  if (s.magic != kMagic || s.sum != fnv1a(&s.c, sizeof s.c)) return false;
  out = s.c;
  return true;
}

}  // namespace tinylap
