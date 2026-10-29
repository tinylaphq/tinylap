#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string>
#include <vector>

namespace tinylap {

// A message from the PC (spec §7). Only the fields of its type are set.
struct Message {
  enum class Type { Unknown, Startup, Reset, Stop, HelloRequest, Pair, Wifi } type = Type::Unknown;
  std::string decoder, token;     // Pair
  std::string ssid, password;     // Wifi: decoded bytes
  std::string raw;                // Unknown
};

// One message, from the text between "%" and "&".
Message parseMessage(const std::string& body);

// Splits the serial stream into messages. Text outside "%...&" is dropped; a message that
// restarts with "%" before its "&" resyncs there; more than 1024 pending characters are dropped.
class Reader {
 public:
  std::vector<Message> push(const char* data, size_t n);

 private:
  std::string pending_;
};

// Framed lines, ready to write.
namespace line {
std::string ack();                                            // %A&
std::string ok();                                             // %TLOK&
std::string error(const std::string& text);                   // % and & are removed from the text
std::string id(const std::string& decoder, const std::string& boot);  // an empty decoder is sent as "-"
std::string lap(const std::string& transponder, uint64_t tMs);
std::string clock(uint64_t tMs);
std::string transponder(uint8_t id);                          // upper-case hex, no padding (spec §6)
}  // namespace line

bool validDecoderId(const std::string& s);  // 1-64 of A-Z a-z 0-9 - _
bool validToken(const std::string& s);      // exactly 43 of the same

}  // namespace tinylap
