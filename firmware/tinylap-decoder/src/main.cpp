// The decoder: IR frames to passings, over ZRound on the USB serial port. Glue only (spec §2.1).
#include <Arduino.h>
#include <atomic>
#include <bootloader_random.h>
#include <esp_log.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/queue.h>
#include "crossings.h"
#include "diag.h"
#include "frames.h"
#include "ir_rmt.h"
#include "net.h"
#include "session.h"
#include "store_nvs.h"

#ifndef FW_VERSION
#define FW_VERSION "unknown"
#endif

using namespace tinylap;

namespace {

// What the IR task hands to loop(). kOverflow is no car: it marks a batch that filled the RMT's memory.
struct QueuedFrame { uint8_t id; int64_t tUs; };
constexpr uint8_t kOverflow = 0xFF;
constexpr int kIrPin = 4;
constexpr uint32_t kIrStackBytes = 12288;  // the buffers below are static; decodeBatch takes 5184 B
constexpr size_t kMaxFrames = 32;         // a batch of 512 levels holds at most ~25 frames
constexpr int64_t kStatUs = 10000000;     // a stat line every 10 s (spec §6.1)
// How far tick runs behind the clock: the idle threshold (2.5 ms), the longest frame (~12 ms) and
// wake-up margin. Frames already stamped may still be in the RMT or the queue (spec §5.3).
constexpr uint32_t kTickLagMs = 20;

QueueHandle_t queue;

// The IR task's counters: it only increments them, loop() only reads them (spec §2.4).
struct IrCounters {
  std::atomic<uint32_t> batches{0}, frames{0}, rejStart{0}, rejBit{0}, rejStop{0}, rejShort{0},
      rejBurst{0}, rejLong{0}, rejParity{0}, overflow{0}, qdrop{0};
};
IrCounters ir_;
std::atomic<uint32_t> rxdrop{0};  // counted on the serial driver's event task

// Counters of the previous run, kept over a crash (spec §6.1).
RTC_NOINIT_ATTR Saved saved;
Counters prev;
bool havePrev = false;

// The rest are loop()'s alone.
Counters own = {};  // pass, single, quiet, minlap, suppressed
EventLimit limit;
int64_t nextStatUs = kStatUs;

uint32_t upMs() { return uint32_t(esp_timer_get_time() / 1000); }

struct SerialSink : Sink {
  void write(const std::string& line) override {
    Serial.write(reinterpret_cast<const uint8_t*>(line.data()), line.size());
  }
} sink;

void event(const std::string& line) {
  if (limit.allow(upMs()))
    sink.write(line);
  else
    own.suppressed++;
}

// Counts every crossing's end and keeps it, so its pass or event line follows the %L it explains
// (spec §6.1). A tick ends at most one crossing per car, an onFrame at most one.
struct Observer : CrossingObserver {
  CrossingEnd ends[130];
  size_t count = 0;
  void ended(const CrossingEnd& e) override {
    switch (e.outcome) {
      case Outcome::Passed: own.pass++; break;
      case Outcome::Single: own.single++; break;
      case Outcome::Quiet: own.quiet++; break;
      case Outcome::MinLap: own.minlap++; break;
    }
    if (count < sizeof ends / sizeof ends[0]) ends[count++] = e;
  }
  // After each onFrame or tick, once its passings are written.
  void flush() {
    for (size_t i = 0; i < count; i++) {
      if (ends[i].outcome == Outcome::Passed)
        sink.write(passLine(ends[i]));
      else
        event(eventLine(ends[i]));
    }
    count = 0;
  }
} observer;

Crossings crossings({}, &observer);

// The boot id's randomness (spec §3). Without Wi-Fi or Bluetooth the ESP32's generator needs the
// SAR ADC's noise, so this switches it on around each draw. It must never run once Wi-Fi is on;
// then the radio makes esp_random() random by itself (Wi-Fi spec §3.6).
uint32_t bootRandom() {
  if (net::on()) return esp_random();
  bootloader_random_enable();
  uint32_t r = esp_random();
  bootloader_random_disable();
  return r;
}

const char* resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "poweron";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT: return "wdt";
    case ESP_RST_SW: return "sw";
    case ESP_RST_EXT: return "ext";
    default: return "other";
  }
}

// Right after each %TLID that starts a boot (spec §6.1).
void onBoot(bool powerOn) {
  static const std::string fw = std::string(FW_VERSION).substr(0, kFwMax);
  if (powerOn) {
    const char* reason = resetReason();
    bool showPrev = havePrev && strcmp(reason, "poweron") != 0;
    std::string line = bootLine(reason, fw.c_str(), showPrev ? &prev : nullptr);
    sink.write(line);
    net::bootLine(line);
  } else {
    std::string line = bootLine("reset", fw.c_str(), nullptr);
    sink.write(line);
    net::bootLine(line);
    net::control()->query();   // after the boot line (connections spec §4.1); the power-up's is in setup()
    crossings.reset();
  }
}

// Tells the net glue about new settings once they are stored, without a reboot (Wi-Fi spec §3.2, §4).
struct NetStore : Store {
  NvsStore nvs;
  UplinkConfig config;
  bool load(std::string& decoder, std::string& token) override { return nvs.load(decoder, token); }
  bool savePairing(const std::string& decoder, const std::string& token) override {
    if (!nvs.savePairing(decoder, token)) return false;
    config.decoder = decoder;
    config.token = token;
    net::setConfig(config);
    return true;
  }
  bool saveWifi(const std::string& ssid, const std::string& password) override {
    if (!nvs.saveWifi(ssid, password)) return false;
    net::setWifi(ssid, password);
    return true;
  }
  bool saveServer(const std::string& url) override {
    if (!nvs.saveServer(url)) return false;
    config.server = url;
    net::setConfig(config);
    return true;
  }
} store;
Session session(store, bootRandom, sink, [](bool powerOn) {
  net::boot(session.boot(), session.bootStartUs());
  onBoot(powerOn);
}, net::control());

// A confirmed passing goes out over the cable and into the outbox (Wi-Fi spec §3.3).
void passed(const Passing& p) {
  session.onPassing(p);
  net::passing(line::transponder(p.id), p.tMs);
}

Counters snapshot() {
  Counters c = own;
  c.batches = ir_.batches;
  c.frames = ir_.frames;
  c.rejStart = ir_.rejStart;
  c.rejBit = ir_.rejBit;
  c.rejStop = ir_.rejStop;
  c.rejShort = ir_.rejShort;
  c.rejBurst = ir_.rejBurst;
  c.rejLong = ir_.rejLong;
  c.rejParity = ir_.rejParity;
  c.overflow = ir_.overflow;
  c.qdrop = ir_.qdrop;
  c.ringlow = uint32_t(ir::ringLowWater());
  c.rxdrop = rxdrop;
  return c;
}

void countRejection(Reject why) {
  switch (why) {
    case Reject::None: break;
    case Reject::Start: ir_.rejStart++; break;
    case Reject::Bit: ir_.rejBit++; break;
    case Reject::Stop: ir_.rejStop++; break;
    case Reject::Short: ir_.rejShort++; break;
    case Reject::Burst: ir_.rejBurst++; break;
    case Reject::Long: ir_.rejLong++; break;
    case Reject::Parity: ir_.rejParity++; break;
  }
}

void send(const QueuedFrame& q) {
  if (xQueueSend(queue, &q, 0) != pdTRUE) ir_.qdrop++;
}

// Core 1, away from Wi-Fi (Wi-Fi spec §3.1): batches to stamped frames on the queue, and nothing
// else (spec §2.4, §5.3).
// Static buffers: a Batch is ~2 KB, too much for the task's stack.
void irTask(void*) {
  static ir::Batch batch;
  static Frame found[kMaxFrames];
  for (;;) {
    if (!ir::receive(batch, portMAX_DELAY)) continue;
    ir_.batches++;
    // Stamped from the raw levels, before the glitch filter merges any.
    int64_t startUs = batchStartUs(batch.readUs, batch.levels, batch.n, ir::kIdleUs);
    if (batch.n == ir::kMaxLevels) {
      ir_.overflow++;
      send({kOverflow, startUs});
    }
    size_t n = filterGlitches(batch.levels, batch.n, kLimits.glitchMax);
    Rejection first = {Reject::None, 0};
    size_t count = decodeBatch(batch.levels, n, kLimits, found, kMaxFrames, &first);
    countRejection(first.why);
    ir_.frames += count;
    for (size_t i = 0; i < count; i++) send({found[i].id, startUs + found[i].offsetUs});
  }
}

}  // namespace

void setup() {
  Serial.setRxBufferSize(1024);
  Serial.setTxBufferSize(2048);  // a boot line takes ~270 ms at 19200; loop() shouldn't wait on it
  Serial.begin(19200);
  // Only loop() may write to this port (spec §2.4). The IDF logs straight into UART0's FIFO,
  // past Serial's buffer and mid-line: the RMT driver from its interrupt on a full ring buffer
  // (through the ROM's putc1, which this removes), NVS and the drivers from their tasks.
  Serial.setDebugOutput(false);
  esp_log_level_set("*", ESP_LOG_NONE);
  Serial.onReceiveError([](hardwareSerial_error_t e) {
    if (e != UART_BREAK_ERROR) rxdrop++;  // a full buffer, an overrun, a framing or parity error
  });

  havePrev = restore(saved, prev);
  save(saved, own);  // from here on, saved holds this run's counters

  store.nvs.begin();  // if NVS fails, load reports nothing stored and saves answer %TLERR store
  session.begin(esp_timer_get_time());  // before net::begin: the power-on boot id takes the ADC's noise

  std::string decoder, ssid, password;
  if (store.nvs.load(decoder, store.config.token) && validDecoderId(decoder)) store.config.decoder = decoder;
  store.nvs.loadServer(store.config.server);
  if (!store.nvs.loadWifi(ssid, password)) ssid.clear();
  // A %TLJOIN that joined is stored without NetStore's setWifi: the net task is on it already.
  net::begin(store.config, ssid, password, [](const std::string& s, const std::string& p) { return store.nvs.saveWifi(s, p); });
  net::control()->query();   // the power-up's %TLNET, after %TLID and the boot line, once begin knows the settings

  queue = xQueueCreate(64, sizeof(QueuedFrame));
  // Without the queue or the receiver there is nothing to read; the stat lines then show batches=0.
  if (queue && ir::begin(kIrPin)) xTaskCreatePinnedToCore(irTask, "ir", kIrStackBytes, nullptr, 10, nullptr, 1);
}

void loop() {
  char buf[128];
  while (int avail = Serial.available()) {
    size_t n = Serial.read(buf, min(size_t(avail), sizeof buf));
    session.onBytes(buf, n, esp_timer_get_time());
  }

  Passing out[128];
  QueuedFrame q;
  while (queue && xQueueReceive(queue, &q, 0) == pdTRUE) {
    uint32_t tMs;
    if (!toBootMs(q.tUs, session.bootStartUs(), &tMs)) continue;  // from before this boot
    if (q.id == kOverflow) {
      event(overflowLine(tMs));
      continue;
    }
    size_t n = crossings.onFrame(q.id, tMs, out, 2);
    for (size_t i = 0; i < n; i++) passed(out[i]);
    observer.flush();
  }

  int64_t now = esp_timer_get_time();
  uint32_t nowMs;
  if (toBootMs(now, session.bootStartUs(), &nowMs)) {
    // Behind the clock, so a crossing is never closed before its last frames arrive (spec §5.3).
    size_t n = crossings.tick(nowMs > kTickLagMs ? nowMs - kTickLagMs : 0, out, 128);
    for (size_t i = 0; i < n; i++) passed(out[i]);
    observer.flush();
  }
  session.tick(now);

  std::string wifi;
  while (net::nextLine(wifi)) sink.write(wifi);  // the net task's lines; only loop() writes Serial

  if (now >= nextStatUs) {
    nextStatUs += kStatUs;
    Counters c = snapshot();
    NetStats n = net::stats();
    std::string line = statLine(c, uint32_t(now / 1000000), ESP.getFreeHeap(), &n);
    sink.write(line);
    net::stat(line);
    save(saved, c);
  }
  vTaskDelay(1);
}
