#include "session.h"
#include "base64url.h"
#include <cctype>

namespace tinylap {

static bool hexDigits(const std::string& s) {
  for (char c : s)
    if (!isxdigit((unsigned char)c)) return false;
  return true;
}

static bool startsWith(const std::string& s, const char* prefix) { return s.rfind(prefix, 0) == 0; }

// The %TLERR text for a name or password that breaks the Wi-Fi limits, or null.
static const char* wifiError(const Message& m) {
  if (m.ssid.empty() || m.ssid.size() > 32) return "Wi-Fi name too long";
  if (!(m.password.empty() || (m.password.size() >= 8 && m.password.size() <= 63) ||
        (m.password.size() == 64 && hexDigits(m.password))))
    return "Wi-Fi password length";
  return nullptr;
}

Session::Session(Store& store, uint32_t (*random)(), Sink& out, std::function<void(bool)> onBoot,
                 NetControl* net)
    : store_(store), random_(random), out_(out), onBoot_(std::move(onBoot)), net_(net) {}

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
        if (const char* bad = wifiError(m)) out_.write(line::error(bad));
        else out_.write(store_.saveWifi(m.ssid, m.password) ? line::ok() : line::error("store"));
        break;
      case Message::Type::NetQuery:
        if (net_) net_->query();
        break;
      case Message::Type::Scan:
        if (net_) net_->scan();
        break;
      case Message::Type::Join:   // the same byte checks as %TLWIFI; the answer is %TLJOINED, from the net side
        if (const char* bad = wifiError(m)) out_.write(line::error(bad));
        else if (net_) net_->join(m.ssid, m.password);
        break;
      case Message::Type::Server:
        if (!(startsWith(m.server, "http://") || startsWith(m.server, "https://")) || m.server.size() > 128) {
          out_.write(line::error("server"));
        } else {
          out_.write(store_.saveServer(m.server) ? line::ok() : line::error("store"));
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
