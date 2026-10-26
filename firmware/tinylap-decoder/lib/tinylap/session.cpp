#include "session.h"
#include "base64url.h"
#include <cctype>

namespace tinylap {

static bool hexDigits(const std::string& s) {
  for (char c : s)
    if (!isxdigit((unsigned char)c)) return false;
  return true;
}

Session::Session(Store& store, uint32_t (*random)(), Sink& out, std::function<void(bool)> onBoot)
    : store_(store), random_(random), out_(out), onBoot_(std::move(onBoot)) {}

void Session::begin(int64_t nowUs) {
  std::string decoder, token;
  decoder_.clear();
  if (store_.load(decoder, token) && validDecoderId(decoder)) decoder_ = decoder;
  newBoot(nowUs, true);
}

// A new boot says who the decoder is, then tells the glue (spec §3).
void Session::newBoot(int64_t nowUs, bool powerOn) {
  boot_ = bootId(random_);
  bootStartUs_ = nowUs;
  nextSecond_ = 1;
  out_.write(line::id(decoder_, boot_));
  if (onBoot_) onBoot_(powerOn);
}

void Session::onBytes(const char* data, size_t n, int64_t nowUs) {
  for (const Message& m : reader_.push(data, n)) {
    switch (m.type) {
      case Message::Type::Startup:
        out_.write(line::ack());
        break;
      case Message::Type::HelloRequest:
        out_.write(line::id(decoder_, boot_));
        break;
      case Message::Type::Pair:
        if (store_.savePairing(m.decoder, m.token)) {
          decoder_ = m.decoder;
          out_.write(line::ok());
        } else {
          out_.write(line::error("store"));
        }
        break;
      case Message::Type::Wifi:
        if (m.ssid.empty() || m.ssid.size() > 32) {
          out_.write(line::error("Wi-Fi name too long"));
        } else if (!(m.password.empty() || (m.password.size() >= 8 && m.password.size() <= 63) ||
                     (m.password.size() == 64 && hexDigits(m.password)))) {
          out_.write(line::error("Wi-Fi password length"));
        } else {
          out_.write(store_.saveWifi(m.ssid, m.password) ? line::ok() : line::error("store"));
        }
        break;
      case Message::Type::Reset:
        newBoot(nowUs, false);
        break;
      default:
        break;   // %F& and anything else: nothing (spec §6)
    }
  }
}

void Session::onPassing(const Passing& p) { out_.write(line::lap(line::transponder(p.id), p.tMs)); }

// Every whole second since the boot, including any a late call missed.
void Session::tick(int64_t nowUs) {
  if (nowUs < bootStartUs_) return;
  uint64_t seconds = (uint64_t)(nowUs - bootStartUs_) / 1000000;
  while (nextSecond_ <= seconds) out_.write(line::clock(nextSecond_++ * 1000));
}

}  // namespace tinylap
