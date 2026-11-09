#pragma once
#include <Preferences.h>
#include "session.h"

// The pairing, the Wi-Fi settings and the server address in NVS, namespace "tinylap" (spec §6).
// Unencrypted: anyone with the board and esptool can read the token.
class NvsStore : public tinylap::Store {
 public:
  bool begin();  // false when NVS can't be opened; every call then fails
  bool load(std::string& decoder, std::string& token) override;
  bool savePairing(const std::string& decoder, const std::string& token) override;
  bool saveWifi(const std::string& ssid, const std::string& password) override;
  bool saveServer(const std::string& url) override;

  // The board's net glue reads these back; not part of Store, which the host tests fake.
  bool loadServer(std::string& url);   // false when none is stored
  bool loadWifi(std::string& ssid, std::string& password);   // false without an ssid; no "pass" is an empty password

 private:
  Preferences prefs_;
};
