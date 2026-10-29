#pragma once
#include <Preferences.h>
#include "session.h"

// The pairing and the Wi-Fi settings in NVS, namespace "tinylap" (spec §6).
// Unencrypted: anyone with the board and esptool can read the token.
class NvsStore : public tinylap::Store {
 public:
  bool begin();  // false when NVS can't be opened; every call then fails
  bool load(std::string& decoder, std::string& token) override;
  bool savePairing(const std::string& decoder, const std::string& token) override;
  bool saveWifi(const std::string& ssid, const std::string& password) override;

 private:
  Preferences prefs_;
};
