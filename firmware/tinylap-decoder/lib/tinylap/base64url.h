#pragma once
#include <stdint.h>
#include <string>

namespace tinylap {

// Decodes unpadded base64url (A-Z a-z 0-9 - _ only). False on any other character or a length of 1 mod 4.
bool base64urlDecode(const std::string& in, std::string& out);

// 11 characters of the base64url alphabet, one per call of random() (spec §7).
std::string bootId(uint32_t (*random)());

}  // namespace tinylap
