#pragma once
#include <stdint.h>
#include <string>
#include "diag.h"
#include "uplink.h"

// Wi-Fi delivery (Wi-Fi spec §3): a task on core 0 owns the Wi-Fi and the HTTP client, and every
// Uplink call goes through one mutex. These are setup()'s and loop()'s; none writes Serial (spec §2.4).
namespace net {

void begin(const tinylap::UplinkConfig& config, const std::string& ssid, const std::string& password);  // no ssid: Wi-Fi stays off
void setWifi(const std::string& ssid, const std::string& password);   // joins the new network at once
void setConfig(const tinylap::UplinkConfig& config);
void passing(const std::string& transponder, uint32_t tMs);
void boot(const std::string& boot, int64_t startUs);
void stat(const std::string& line);       // whole %TLLOG lines
void bootLine(const std::string& line);
bool on();                                // Wi-Fi started; it stays on until the next reset
tinylap::NetStats stats();
bool nextLine(std::string& line);         // a %TLLOG wifi line for loop() to write; false when none waits

}  // namespace net
