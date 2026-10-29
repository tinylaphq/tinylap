#include "zround.h"
#include "base64url.h"

namespace tinylap {

static const size_t kMaxPending = 1024;

static bool urlSafe(char c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
}

static bool allUrlSafe(const std::string& s, size_t min, size_t max) {
  if (s.size() < min || s.size() > max) return false;
  for (char c : s)
    if (!urlSafe(c)) return false;
  return true;
}

bool validDecoderId(const std::string& s) { return allUrlSafe(s, 1, 64); }
bool validToken(const std::string& s) { return allUrlSafe(s, 43, 43); }

// Strict UTF-8, as JavaScript's TextDecoder with fatal: true: no overlong forms, surrogates or values past U+10FFFF.
static bool validUtf8(const std::string& s) {
  size_t i = 0, n = s.size();
  while (i < n) {
    uint8_t c = (uint8_t)s[i];
    size_t len;
    uint32_t cp;
    if (c < 0x80) { i++; continue; }
    if (c >= 0xC2 && c <= 0xDF) { len = 2; cp = c & 0x1F; }
    else if (c >= 0xE0 && c <= 0xEF) { len = 3; cp = c & 0x0F; }
    else if (c >= 0xF0 && c <= 0xF4) { len = 4; cp = c & 0x07; }
    else return false;
    if (i + len > n) return false;
    for (size_t k = 1; k < len; k++) {
      uint8_t cc = (uint8_t)s[i + k];
      if ((cc & 0xC0) != 0x80) return false;
      cp = (cp << 6) | (cc & 0x3F);
    }
    if (len == 3 && (cp < 0x800 || (cp >= 0xD800 && cp <= 0xDFFF))) return false;
    if (len == 4 && (cp < 0x10000 || cp > 0x10FFFF)) return false;
    i += len;
  }
  return true;
}

static bool decodeText(const std::string& field, std::string& out) {
  return base64urlDecode(field, out) && validUtf8(out);
}

Message parseMessage(const std::string& body) {
  Message m;
  m.raw = body;
  if (body == "C") m.type = Message::Type::Startup;
  else if (body == "I") m.type = Message::Type::Reset;
  else if (body == "F") m.type = Message::Type::Stop;
  else if (body.compare(0, 2, "TL") == 0) {
    // Single spaces split the fields, empty ones kept.
    std::vector<std::string> fields;
    size_t start = 0;
    for (;;) {
      size_t sp = body.find(' ', start);
      if (sp == std::string::npos) { fields.push_back(body.substr(start)); break; }
      fields.push_back(body.substr(start, sp - start));
      start = sp + 1;
    }
    const std::string& word = fields[0];
    if (word == "TLHELLO" && fields.size() == 1) m.type = Message::Type::HelloRequest;
    else if (word == "TLPAIR" && fields.size() == 3 && validDecoderId(fields[1]) && validToken(fields[2])) {
      m.type = Message::Type::Pair;
      m.decoder = fields[1];
      m.token = fields[2];
    } else if (word == "TLWIFI" && fields.size() == 3) {
      std::string ssid, password;
      if (decodeText(fields[1], ssid) && decodeText(fields[2], password)) {
        m.type = Message::Type::Wifi;
        m.ssid = ssid;
        m.password = password;
      }
    }
  }
  if (m.type != Message::Type::Unknown) m.raw.clear();
  return m;
}

std::vector<Message> Reader::push(const char* data, size_t n) {
  pending_.append(data, n);
  std::vector<Message> out;
  for (;;) {
    size_t start = pending_.find('%');
    if (start == std::string::npos) { pending_.clear(); break; }
    size_t end = pending_.find('&', start);
    if (end == std::string::npos) { pending_.erase(0, start); break; }
    // A cut-off message restarts at the last "%" before the "&".
    size_t from = pending_.rfind('%', end);
    out.push_back(parseMessage(pending_.substr(from + 1, end - from - 1)));
    pending_.erase(0, end + 1);
  }
  if (pending_.size() > kMaxPending) pending_.clear();
  return out;
}

static std::string hex(uint64_t n) {
  static const char digits[] = "0123456789ABCDEF";
  std::string s;
  do { s.insert(s.begin(), digits[n & 15]); n >>= 4; } while (n);
  return s;
}

namespace line {
std::string ack() { return "%A&"; }
std::string ok() { return "%TLOK&"; }
std::string error(const std::string& text) {
  std::string clean;
  for (char c : text)
    if (c != '%' && c != '&') clean.push_back(c);
  return "%TLERR " + clean + "&";
}
std::string id(const std::string& decoder, const std::string& boot) {
  return "%TLID " + (decoder.empty() ? std::string("-") : decoder) + " " + boot + "&";
}
std::string lap(const std::string& transponder, uint64_t tMs) { return "%L" + transponder + "," + hex(tMs) + "&"; }
std::string clock(uint64_t tMs) { return "%T" + hex(tMs) + "&"; }
std::string transponder(uint8_t id) { return hex(id); }
}  // namespace line

}  // namespace tinylap
