#pragma once
#include <stdint.h>
#include <string>
#include "diag.h"
#include "session.h"
#include "uplink.h"

// Wi-Fi delivery (Wi-Fi spec §3): a task on core 1, beside loop(), owns the Wi-Fi and the HTTP client, and every
// Uplink call goes through one mutex. These are setup()'s and loop()'s; none writes Serial (spec §2.4).
namespace net {

// save stores the settings a %TLJOIN joined with, on the net task; it must not call setWifi.
void begin(const tinylap::UplinkConfig& config, const std::string& ssid, const std::string& password,
           bool (*save)(const std::string& ssid, const std::string& password));  // no ssid: Wi-Fi stays off
void setWifi(const std::string& ssid, const std::string& password);   // joins the new network at once
void setConfig(const tinylap::UplinkConfig& config);
void passing(const std::string& transponder, uint32_t tMs);
void boot(const std::string& boot, int64_t startUs);
void stat(const std::string& line);       // whole %TLLOG lines
void bootLine(const std::string& line);
bool on();                                // Wi-Fi started; it stays on until the next reset
tinylap::NetStats stats();
bool nextLine(std::string& line);         // a line from the net task for loop() to write; false when none waits
// %TLNET, %TLSCAN and %TLJOIN (connections spec §4), answered through nextLine; for the Session, and
// query() for the boot's %TLNET.
tinylap::NetControl* control();

}  // namespace net
