#include "store_nvs.h"

bool NvsStore::begin() { return prefs_.begin("tinylap", false); }

bool NvsStore::load(std::string& decoder, std::string& token) {
  if (!prefs_.isKey("decoder") || !prefs_.isKey("token")) return false;
  decoder = prefs_.getString("decoder").c_str();
  token = prefs_.getString("token").c_str();
  return true;
}

bool NvsStore::savePairing(const std::string& decoder, const std::string& token) {
  return prefs_.putString("token", token.c_str()) == token.size() &&
         prefs_.putString("decoder", decoder.c_str()) == decoder.size();
}

// Bytes, not strings: an SSID may hold NUL (spec §6). An open network has no password,
// and NVS can't hold an empty blob, so that is no "pass" key.
bool NvsStore::saveWifi(const std::string& ssid, const std::string& password) {
  if (prefs_.putBytes("ssid", ssid.data(), ssid.size()) != ssid.size()) return false;
  if (password.empty()) return !prefs_.isKey("pass") || prefs_.remove("pass");
  return prefs_.putBytes("pass", password.data(), password.size()) == password.size();
}

bool NvsStore::saveServer(const std::string& url) {
  return prefs_.putString("server", url.c_str()) == url.size();
}

bool NvsStore::loadServer(std::string& url) {
  if (!prefs_.isKey("server")) return false;
  url = prefs_.getString("server").c_str();
  return true;
}

bool NvsStore::loadWifi(std::string& ssid, std::string& password) {
  size_t n = prefs_.getBytesLength("ssid");
  if (n == 0) return false;
  ssid.assign(n, '\0');
  if (prefs_.getBytes("ssid", &ssid[0], n) != n) return false;
  password.clear();
  n = prefs_.getBytesLength("pass");
  if (n == 0) return true;
  password.assign(n, '\0');
  return prefs_.getBytes("pass", &password[0], n) == n;
}
