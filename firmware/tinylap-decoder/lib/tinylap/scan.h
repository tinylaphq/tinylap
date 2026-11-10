#pragma once
#include <stddef.h>
#include <string>
#include <vector>

namespace tinylap {

struct ApRecord { std::string ssid; int rssi; bool open; };   // one access point a scan heard; ssid in bytes

// The %TLSCAN answer (connections spec §4.2): one %TLAP per name, the strongest access point of
// each, strongest first, hidden (empty) names left out, at most max; then %TLSCANEND with the count.
std::vector<std::string> scanLines(const std::vector<ApRecord>& records, size_t max = 30);

}  // namespace tinylap
