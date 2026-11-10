#pragma once
#include <functional>
#include <stddef.h>
#include <stdint.h>
#include <string>
#include "crossings.h"
#include "zround.h"

namespace tinylap {

// Where the pairing, the Wi-Fi settings and the server address live (NVS on the board).
struct Store {
  virtual bool load(std::string& decoder, std::string& token) = 0;     // false when nothing is stored
  virtual bool savePairing(const std::string& decoder, const std::string& token) = 0;
  virtual bool saveWifi(const std::string& ssid, const std::string& password) = 0;   // bytes, may hold NUL
  virtual bool saveServer(const std::string& url) = 0;
  virtual ~Store() = default;
};

// The Wi-Fi side's commands from the PC (spec §4). It answers later, on its own task, through the
// serial lines the loop writes; Session does not reply to these.
struct NetControl {
  virtual void query() = 0;                                                       // %TLNET&
  virtual void scan() = 0;                                                        // %TLSCAN&
  virtual void join(const std::string& name, const std::string& password) = 0;   // %TLJOIN, bytes checked
  virtual ~NetControl() = default;
};

// Takes whole lines, one write each.
struct Sink {
  virtual void write(const std::string& line) = 0;
  virtual ~Sink() = default;
};

// The decoder's side of the serial conversation, its boot and its clock (spec §3, §6).
class Session {
 public:
  Session(Store& store, uint32_t (*random)(), Sink& out, std::function<void(bool powerOn)> onBoot = {},
          NetControl* net = nullptr);   // net: null on a board without Wi-Fi
  void begin(int64_t nowUs);                                  // loads the pairing (a bad id counts as unpaired), new boot, %TLID
  void onBytes(const char* data, size_t n, int64_t nowUs);    // replies per spec §6
  // onBoot runs right after every %TLID that starts a boot: powerOn true from begin(), false for %I&
  void onPassing(const Passing& p);                           // %L<line::transponder(p.id)>,<hex tMs>&
  void tick(int64_t nowUs);                                   // %T at every whole second of the boot, the first at 1000
  int64_t bootStartUs() const { return bootStartUs_; }
  const std::string& boot() const { return boot_; }

 private:
  void newBoot(int64_t nowUs, bool powerOn);

  Reader reader_;

  Store& store_;
  uint32_t (*random_)();
  Sink& out_;
  std::function<void(bool)> onBoot_;
  NetControl* net_;
  std::string decoder_, boot_;
  int64_t bootStartUs_ = 0;
  uint64_t nextSecond_ = 1;   // the next whole second of this boot to report
};

}  // namespace tinylap
