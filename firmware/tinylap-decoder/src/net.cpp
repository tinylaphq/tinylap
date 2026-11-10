// Wi-Fi and HTTPS for the outbox (Wi-Fi spec §3.2, §3.4, §3.5). The Uplink decides what to post and
// when; this joins the network, does the HTTP, scans and tries new settings (connections spec §4)
// and hands its lines to loop().
#include "net.h"
#include <algorithm>
#include <atomic>
#include <new>
#include <vector>
#include <esp_crt_bundle.h>
#include <esp_event.h>
#include <esp_http_client.h>
#include <esp_netif.h>
#include <esp_timer.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <stdlib.h>
#include <string.h>
#include "scan.h"
#include "zround.h"

using namespace tinylap;

namespace net {
namespace {

constexpr uint32_t kStackBytes = 12288;   // the TLS handshake runs on this task's stack
// Core 1 at loop()'s priority (spec §3.1). A TLS handshake computes for seconds without blocking:
// on core 0 it would starve the idle task the task watchdog watches, or at idle priority take twice
// as long. Here it takes turns with loop(), which yields every pass; the IR task stays above both.
constexpr BaseType_t kCore = 1;
constexpr UBaseType_t kPriority = 1;
constexpr int64_t kJoinMinUs = 1000000, kJoinMaxUs = 30000000;   // rejoin back-off (spec §3.2)
constexpr int64_t kJoinTimeoutUs = 30000000;   // a join that never gets an address
constexpr int64_t kTryUs = 20000000;           // a %TLJOIN's try: the scan and the join (connections spec §4.3)
constexpr int kHttpTimeoutMs = 10000;
constexpr TickType_t kIdleTicks = pdMS_TO_TICKS(100);
constexpr size_t kMaxBody = 1024;   // an answer is {"through":…}

struct Event { enum Kind : uint8_t { Kick, Disconnected, GotIp } kind; int32_t reason; };
struct Line { char text[96]; };   // a %TLNET with a 32-byte name is about 80 bytes
// A scan's 31 lines and what else waits. The net task also waits for room for them (pushLine's wait),
// so no line of a scan or a %TLJOINED is lost; lines pushed under the mutex never wait.
constexpr UBaseType_t kLines = 40;

// Made on the first call, from setup() (the boot's onBoot runs before begin).
SemaphoreHandle_t mutex;
QueueHandle_t events;   // Wi-Fi events and kicks, to the net task
QueueHandle_t lines;    // the net side's lines, to loop()

// Under the mutex: the Uplink and the Wi-Fi settings not yet taken by the net task.
Uplink* uplink;
std::string ssid_, password_;
bool wifiChanged_ = false;
bool (*save_)(const std::string&, const std::string&) = nullptr;
// The PC's requests not yet taken by the net task, and whether it died at the start (then nobody would answer).
bool scanWanted_ = false, tryWanted_ = false, broken_ = false;
std::string tryName_, tryPassword_;
// What the last %TLNET said; a new one goes out only when its state, name or cause changes (connections spec §4.3).
struct Shown { const char* state; std::string name; int signal; const char* cause; } shown_{"off", "", 0, "none"};

std::atomic<bool> on_{false};   // only setup() and loop() set it, the thread that calls bootRandom() (spec §3.6)
std::atomic<NetState> state_{NetState::Off};   // the net task's

struct Lock {
  Lock() { xSemaphoreTake(mutex, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(mutex); }
};

void init() {
  if (mutex) return;
  mutex = xSemaphoreCreateMutex();
  events = xQueueCreate(16, sizeof(Event));
  lines = xQueueCreate(kLines, sizeof(Line));
  uplink = new Uplink();   // its ring takes ~32 KB, once
}

// Wakes the net task. Kicks only go to an empty queue, so they never crowd out a Wi-Fi event.
void kick() {
  Event e{Event::Kick, 0};
  if (on_ && uxQueueMessagesWaiting(events) == 0) xQueueSend(events, &e, 0);
}

void pushLine(const std::string& s, TickType_t wait = 0) {
  Line l;
  strlcpy(l.text, s.c_str(), sizeof l.text);
  xQueueSend(lines, &l, wait);   // full: loop() is far behind, the line is lost
}

// The net task's answers to the PC: they wait for loop() to make room. Never under the mutex, which loop() takes.
void answerLine(const std::string& s) { pushLine(s, portMAX_DELAY); }

// Under the mutex, so a %TLNET& answer and a change go out in the order they happened.
void show(const char* state, const std::string& name, int signal, const char* cause) {
  bool same = strcmp(state, shown_.state) == 0 && name == shown_.name && strcmp(cause, shown_.cause) == 0;
  shown_ = Shown{state, name, signal, cause};
  if (!same) pushLine(line::net(state, name, signal, cause));
}

// The ESP-IDF disconnect reason as %TLNET and %TLJOINED name it (connections spec §4.1).
const char* causeOf(int reason) {
  switch (reason) {
    case 2: case 15: case 202: case 204: return "password";   // auth expired, 4-way handshake, auth fail, handshake timeout
    case 201: return "notfound";
    default: return "other";
  }
}

// "%TLLOG stat …&" to "stat …", as the Uplink takes log lines.
std::string logText(const std::string& line) {
  const size_t prefix = strlen("%TLLOG ");
  if (line.size() < prefix + 1 || line.compare(0, prefix, "%TLLOG ") != 0 || line.back() != '&') return line;
  return line.substr(prefix, line.size() - prefix - 1);
}

// On the default event loop's task: pass it on, nothing else.
void onEvent(void*, esp_event_base_t base, int32_t id, void* data) {
  Event e{Event::Kick, 0};
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    e.kind = Event::Disconnected;
    e.reason = static_cast<wifi_event_sta_disconnected_t*>(data)->reason;
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    e.kind = Event::GotIp;
  } else {
    return;
  }
  xQueueSend(events, &e, 0);
}

bool startDriver() {
  esp_netif_init();
  esp_event_loop_create_default();   // fails harmlessly when it exists
  esp_netif_create_default_wifi_sta();
  wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
  if (esp_wifi_init(&cfg) != ESP_OK) return false;
  esp_wifi_set_storage(WIFI_STORAGE_RAM);   // settings live in our NVS keys; NVS writes stall both cores
  esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, onEvent, nullptr);
  esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, onEvent, nullptr);
  if (esp_wifi_set_mode(WIFI_MODE_STA) != ESP_OK || esp_wifi_start() != ESP_OK) return false;
  esp_wifi_set_ps(WIFI_PS_MIN_MODEM);   // spec §3.2
  return true;
}

// Sets the station's network; the name and password are bytes and may hold NUL.
void setStation(const std::string& ssid, const std::string& password) {
  wifi_config_t c = {};
  memcpy(c.sta.ssid, ssid.data(), std::min(ssid.size(), sizeof c.sta.ssid));
  memcpy(c.sta.password, password.data(), std::min(password.size(), sizeof c.sta.password));
  // The strongest access point of that name, not the first one heard: a club or office network
  // has several, and a distant one refuses the association (reason 203). PMF capable, so a
  // WPA2/WPA3 network can use it.
  c.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
  c.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
  c.sta.pmf_cfg.capable = true;
  esp_wifi_set_config(WIFI_IF_STA, &c);
}

// Whether the access point has this name, in bytes: the driver keeps up to 32, NUL-padded.
bool sameName(const wifi_ap_record_t& ap, const std::string& name) {
  const size_t n = std::min(name.size(), size_t(32));
  return memcmp(ap.ssid, name.data(), n) == 0 && (n == 32 || ap.ssid[n] == 0);
}

// A blocking scan of all channels, as the %TLSCAN answer (connections spec §4.2). Connected, the
// radio leaves the channel meanwhile; a link it costs comes back as a disconnect, rejoined as any.
std::vector<std::string> scanNetworks() {
  wifi_scan_config_t sc = {};   // all channels, active, hidden names left out
  if (esp_wifi_scan_start(&sc, true) != ESP_OK) return {line::error("scan")};
  uint16_t n = 0;
  esp_wifi_scan_get_ap_num(&n);
  std::vector<ApRecord> records;
  if (n > 0) {
    wifi_ap_record_t* aps = new (std::nothrow) wifi_ap_record_t[n];   // ~80 bytes each, on the heap
    if (!aps) {
      esp_wifi_clear_ap_list();
      return {line::error("scan")};
    }
    if (esp_wifi_scan_get_ap_records(&n, aps) == ESP_OK)
      for (uint16_t i = 0; i < n; i++) {
        const char* name = reinterpret_cast<const char*>(aps[i].ssid);
        records.push_back({std::string(name, strnlen(name, sizeof aps[i].ssid)), aps[i].rssi, aps[i].authmode == WIFI_AUTH_OPEN});
      }
    delete[] aps;
  }
  return scanLines(records);
}

// The HTTP side, the net task's alone.
struct Response { std::string body; int64_t retryAfterS = 0; } response;
esp_http_client_handle_t client;
std::string clientUrl;
bool clientOpen = false;   // a kept-alive connection from the last request

esp_err_t onHttp(esp_http_client_event_t* e) {
  if (e->event_id == HTTP_EVENT_ON_HEADER && strcasecmp(e->header_key, "Retry-After") == 0)
    response.retryAfterS = atoll(e->header_value);   // an HTTP date reads as 0: an ordinary back-off
  else if (e->event_id == HTTP_EVENT_ON_DATA && response.body.size() < kMaxBody)
    response.body.append(static_cast<const char*>(e->data), e->data_len);
  return ESP_OK;
}

// The status, or 0 for no connection or a timeout. Certificates are checked against the IDF bundle (spec §3.4).
int post(const Request& r) {
  if (!client || clientUrl != r.url) {
    if (client) esp_http_client_cleanup(client);
    esp_http_client_config_t cfg = {};
    cfg.url = r.url.c_str();
    cfg.method = HTTP_METHOD_POST;
    cfg.timeout_ms = kHttpTimeoutMs;
    cfg.event_handler = onHttp;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.keep_alive_enable = true;
    client = esp_http_client_init(&cfg);
    clientUrl = r.url;
    clientOpen = false;
    if (!client) return 0;
  }
  esp_http_client_set_header(client, "Authorization", r.auth.c_str());
  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_post_field(client, r.body.data(), r.body.size());
  for (int attempt = 0;; attempt++) {
    response = Response();
    int64_t startUs = esp_timer_get_time();
    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
      clientOpen = true;
      return esp_http_client_get_status_code(client);
    }
    esp_http_client_close(client);
    // Once more only when the server closed the kept connection, not after a timeout: the task
    // must not sit 20 s on one batch while a Wi-Fi event or a %TLWIFI waits. Some timeouts come
    // back as a header error, so a failure that took half the timeout counts as one too.
    bool timedOut = err == ESP_ERR_HTTP_EAGAIN || err == ESP_ERR_TIMEOUT ||
                    esp_timer_get_time() - startUs > int64_t(kHttpTimeoutMs) * 500;
    bool retry = clientOpen && attempt == 0 && !timedOut;
    clientOpen = false;
    if (!retry) return 0;
  }
}

// Core 1, beside loop(): the Wi-Fi connection, the posts, the scans and the tries (spec §3.1, §3.2,
// §3.4; connections spec §4).
void netTask(void*) {
  // Should never happen. If it does, Wi-Fi stays off until the next reset: on_ stays set, a later
  // %TLWIFI only stores its settings, and a %TLSCAN or %TLJOIN is answered at once.
  if (!startDriver()) {
    pushLine(wifiLine("failed", 0, -1));
    state_ = NetState::Off;
    Lock lock;
    if (scanWanted_) pushLine(line::error("scan"));
    if (tryWanted_) pushLine(line::joined("other"));
    scanWanted_ = tryWanted_ = false;
    broken_ = true;
    vTaskDelete(nullptr);
  }
  bool haveWifi = false, joining = false, connected = false;
  bool leaving = false;   // our esp_wifi_disconnect()'s event is still to come
  int64_t joinAtUs = 0, joinStartUs = 0, backoffUs = kJoinMinUs;
  TickType_t wait = 0;
  std::string ssid, password;   // the stored settings, which the board goes back to after a try
  // A %TLJOIN's try: its settings are on the station, and the back-off rejoin waits until it ends.
  bool trying = false;
  int64_t tryStartUs = 0;
  std::string tryName, tryPassword;

  auto failed = [&](int reason, int64_t now) {
    if (connected) backoffUs = kJoinMinUs;   // a drop starts the back-off over
    joining = connected = false;
    state_ = NetState::Connecting;
    pushLine(wifiLine("failed", 0, reason));
    joinAtUs = now + backoffUs;
    backoffUs = std::min(backoffUs * 2, kJoinMaxUs);
    Lock lock;   // the retries keep the first failure's cause until connected (connections spec §4.3)
    if (strcmp(shown_.state, "failed") != 0) show("failed", ssid, 0, causeOf(reason));
  };

  // The try did not join: back to the stored settings, rejoined at once, or to no Wi-Fi without any.
  auto tryFailed = [&](int reason, const char* cause, int64_t now) {
    trying = joining = connected = false;
    pushLine(wifiLine("failed", 0, reason));
    if (haveWifi) setStation(ssid, password);
    backoffUs = kJoinMinUs;
    joinAtUs = now;
    state_ = haveWifi ? NetState::Connecting : NetState::Off;
    {
      Lock lock;
      if (haveWifi) show("joining", ssid, 0, "none");
      else show("off", "", 0, "none");
    }
    answerLine(line::joined(cause));
  };

  for (;;) {
    Event e;
    for (BaseType_t got = xQueueReceive(events, &e, wait); got == pdTRUE; got = xQueueReceive(events, &e, 0)) {
      int64_t now = esp_timer_get_time();
      if (e.kind == Event::Disconnected) {
        // The one after our own leave (new settings, a try, a join timeout) is ours, whatever its
        // reason; otherwise only a join or a connection can fail.
        if (leaving) leaving = false;
        else if (trying && joining) tryFailed(e.reason, causeOf(e.reason), now);
        else if (joining || connected) failed(e.reason, now);
      } else if (e.kind == Event::GotIp && joining) {   // a late one from a join we gave up is no link
        wifi_ap_record_t ap;
        bool info = esp_wifi_sta_get_ap_info(&ap) == ESP_OK;
        // During a try, only the tried network counts: a link the old join made just before the
        // try left it must not store the new settings.
        if (trying && !(info && sameName(ap, tryName))) continue;
        joining = false;
        leaving = false;   // a new link: no leave event is still coming
        connected = true;
        backoffUs = kJoinMinUs;
        state_ = NetState::Connected;
        int rssi = info ? ap.rssi : 0;
        pushLine(wifiLine("connected", rssi, 0));
        // The try joined: its settings are kept, stored as %TLWIFI stores them (connections spec §4.3).
        // If storing fails the board stays on it until the next reset, and says so.
        std::string reply;
        if (trying) {
          trying = false;
          ssid = tryName;
          password = tryPassword;
          haveWifi = true;
          bool (*save)(const std::string&, const std::string&);
          {
            Lock lock;
            save = save_;
          }
          reply = save && save(ssid, password) ? line::joined("ok") : line::error("store");
        }
        {
          Lock lock;
          show("connected", ssid, rssi, "none");
          uplink->onConnected(now);
        }
        if (!reply.empty()) answerLine(reply);
      }
    }
    wait = kIdleTicks;
    int64_t now = esp_timer_get_time();

    // New settings (%TLWIFI): leave the old network and join the new one at once (spec §3.2). They
    // end a try, which keeps nothing.
    std::string newSsid, newPassword;
    bool changed = false;
    {
      Lock lock;
      if (wifiChanged_) {
        newSsid = ssid_;
        newPassword = password_;
        wifiChanged_ = false;
        changed = true;
      }
    }
    if (changed) {
      if (joining || connected) leaving = true;   // only then does the driver report the leave
      esp_wifi_disconnect();
      if (trying) {
        trying = false;
        answerLine(line::joined("other"));
      }
      ssid = newSsid;
      password = newPassword;
      setStation(ssid, password);
      haveWifi = true;
      joining = connected = false;
      backoffUs = kJoinMinUs;
      joinAtUs = now;
      state_ = NetState::Connecting;
      Lock lock;
      show("joining", ssid, 0, "none");
    }

    if (trying && now - tryStartUs > kTryUs) {
      leaving = true;   // the try's join is still running
      esp_wifi_disconnect();
      tryFailed(0, "timeout", now);
    }
    if (joining && !trying && now - joinStartUs > kJoinTimeoutUs) {
      leaving = true;
      esp_wifi_disconnect();
      failed(0, now);
    }

    // A scan waits while a join runs (the driver's own scan); a %TLSCAN while one runs gets its answer.
    bool scan;
    {
      Lock lock;
      scan = scanWanted_;
    }
    if (scan && !joining) {
      std::vector<std::string> found = scanNetworks();
      {
        Lock lock;
        scanWanted_ = false;
      }
      for (const std::string& l : found) answerLine(l);
      now = esp_timer_get_time();
    }

    // A %TLJOIN: leave the network and try the new settings once (connections spec §4.3).
    bool tryNow = false;
    if (!trying) {
      Lock lock;
      if (tryWanted_) {
        tryName = tryName_;
        tryPassword = tryPassword_;
        tryWanted_ = false;
        tryNow = true;
      }
    }
    if (tryNow) {
      if (joining || connected) leaving = true;
      esp_wifi_disconnect();
      setStation(tryName, tryPassword);
      trying = true;
      tryStartUs = now;
      connected = false;
      state_ = NetState::Connecting;
      {
        Lock lock;
        show("joining", tryName, 0, "none");
      }
      pushLine(wifiLine("connecting", 0, 0));
      joining = true;
      joinStartUs = now;
      if (esp_wifi_connect() != ESP_OK) tryFailed(0, "other", now);
    }

    if (haveWifi && !trying && !joining && !connected && now >= joinAtUs) {
      pushLine(wifiLine("connecting", 0, 0));
      joining = true;
      joinStartUs = now;
      if (esp_wifi_connect() != ESP_OK) failed(0, now);
    }

    if (!connected) continue;
    Request req;
    bool due;
    {
      Lock lock;
      due = uplink->next(now, req);
    }
    if (!due) continue;
    int status = post(req);   // outside the mutex: loop() keeps adding passings meanwhile
    {
      Lock lock;
      uplink->answer(status, response.body, esp_timer_get_time(), response.retryAfterS);
    }
    wait = 0;   // more may be due at once
  }
}

// From setup() or loop(): on_ is set before the task starts the radio, so bootRandom() never
// overlaps a running Wi-Fi (spec §3.6).
void start() {
  if (on_) return;
  on_ = true;
  xTaskCreatePinnedToCore(netTask, "net", kStackBytes, nullptr, kPriority, nullptr, kCore);
}

struct Control : NetControl {
  void query() override {
    init();
    Lock lock;
    pushLine(line::net(shown_.state, shown_.name, shown_.signal, shown_.cause));
  }
  void scan() override {
    init();
    {
      Lock lock;
      if (broken_) {
        pushLine(line::error("scan"));
        return;
      }
      scanWanted_ = true;
    }
    start();
    kick();
  }
  void join(const std::string& name, const std::string& password) override {
    init();
    {
      Lock lock;
      if (broken_) {
        pushLine(line::joined("other"));
        return;
      }
      tryName_ = name;   // a second %TLJOIN during a try runs after it, the last one only
      tryPassword_ = password;
      tryWanted_ = true;
    }
    start();
    kick();
  }
};

}  // namespace

void begin(const UplinkConfig& config, const std::string& ssid, const std::string& password,
           bool (*save)(const std::string&, const std::string&)) {
  init();
  {
    Lock lock;
    save_ = save;
  }
  setConfig(config);
  if (!ssid.empty()) setWifi(ssid, password);
}

void setWifi(const std::string& ssid, const std::string& password) {
  init();
  {
    Lock lock;
    ssid_ = ssid;
    password_ = password;
    wifiChanged_ = true;
    show("joining", ssid, 0, "none");   // at once, so the power-up's %TLNET names it
  }
  state_ = NetState::Connecting;
  start();
  kick();
}

void setConfig(const UplinkConfig& config) {
  init();
  {
    Lock lock;
    uplink->configure(config);
  }
  kick();
}

void passing(const std::string& transponder, uint32_t tMs) {
  init();
  {
    Lock lock;
    uplink->onPassing(transponder, tMs, esp_timer_get_time());
  }
  kick();
}

void boot(const std::string& boot, int64_t startUs) {
  init();
  Lock lock;
  uplink->onBoot(boot, startUs);
}

void stat(const std::string& line) {
  init();
  {
    Lock lock;
    uplink->onStat(logText(line), esp_timer_get_time());
  }
  kick();
}

void bootLine(const std::string& line) {
  init();
  Lock lock;
  uplink->onBootLine(logText(line));
}

bool on() { return on_; }

NetStats stats() {
  init();
  Lock lock;
  NetState s = !on_ ? NetState::Off : uplink->paused() ? NetState::Paused : state_.load();
  const char* names[] = {"off", "connecting", "connected", "paused"};
  return NetStats{names[static_cast<int>(s)], uint32_t(uplink->waiting()), uplink->dropped(), uplink->lastStatus()};
}

NetControl* control() {
  static Control c;
  return &c;
}

bool nextLine(std::string& line) {
  Line l;
  if (!lines || xQueueReceive(lines, &l, 0) != pdTRUE) return false;
  line = l.text;
  return true;
}

}  // namespace net
