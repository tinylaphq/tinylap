#include "base64url.h"

namespace tinylap {

static const char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

static int valueOf(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '-') return 62;
  if (c == '_') return 63;
  return -1;
}

bool base64urlDecode(const std::string& in, std::string& out) {
  out.clear();
  if (in.size() % 4 == 1) return false;
  uint32_t acc = 0;
  int bits = 0;
  for (char c : in) {
    int v = valueOf(c);
    if (v < 0) return false;
    acc = (acc << 6) | (uint32_t)v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back((char)((acc >> bits) & 0xFF));
    }
  }
  return true;
}

std::string bootId(uint32_t (*random)()) {
  std::string id;
  for (int i = 0; i < 11; i++) id.push_back(kAlphabet[random() % 64]);
  return id;
}

}  // namespace tinylap
