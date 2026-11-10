#include "scan.h"
#include <algorithm>
#include "zround.h"

namespace tinylap {

std::vector<std::string> scanLines(const std::vector<ApRecord>& records, size_t max) {
  std::vector<ApRecord> best;   // one per name
  for (const ApRecord& r : records) {
    if (r.ssid.empty()) continue;
    auto same = std::find_if(best.begin(), best.end(), [&](const ApRecord& b) { return b.ssid == r.ssid; });
    if (same == best.end()) best.push_back(r);
    else if (r.rssi > same->rssi) *same = r;
  }
  std::stable_sort(best.begin(), best.end(), [](const ApRecord& a, const ApRecord& b) { return a.rssi > b.rssi; });
  if (best.size() > max) best.resize(max);
  std::vector<std::string> lines;
  for (const ApRecord& r : best) lines.push_back(line::ap(r.ssid, r.rssi, r.open));
  lines.push_back(line::scanEnd(int(best.size())));
  return lines;
}

}  // namespace tinylap
