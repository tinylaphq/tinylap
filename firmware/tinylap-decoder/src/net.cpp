// Wi-Fi and HTTPS for the outbox (Wi-Fi spec §3.2, §3.4, §3.5). The Uplink decides what to post and
// when; this joins the network, does the HTTP and hands Wi-Fi lines to loop().
#include "net.h"
#include <algorithm>
#include <atomic>
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

using namespace tinylap;

namespace net {
namespace {

constexpr uint32_t kStackBytes = 12288;   // the TLS handshake runs on this task's stack
// The idle task's: a TLS handshake computes for seconds without blocking, and above idle it would
// starve core 0's idle task until the task watchdog resets the board. Wi-Fi and lwIP stay above it.
constexpr UBaseType_t kPriority = tskIDLE_PRIORITY;
constexpr int64_t kJoinMinUs = 1000000, kJoinMaxUs = 30000000;   // rejoin back-off (spec §3.2)
constexpr int64_t kJoinTimeoutUs = 30000000;   // a join that never gets an address
constexpr int kHttpTimeoutMs = 10000;
constexpr TickType_t kIdleTicks = pdMS_TO_TICKS(100);
constexpr size_t kMaxBody = 1024;   // an answer is {"through":…}

struct Event { enum Kind : uint8_t { Kick, Disconnected, GotIp } kind; int32_t reason; };
struct Line { char text[64]; };   // a wifi line is under 50 bytes

// Made on the first call, from setup() (the boot's onBoot runs before begin).
SemaphoreHandle_t mutex;
QueueHandle_t events;   // Wi-Fi events and kicks, to the net task
QueueHandle_t lines;    // wifi lines, to loop()

// Under the mutex: the Uplink and the Wi-Fi settings not yet taken by the net task.
Uplink* uplink;
std::string ssid_, password_;
bool wifiChanged_ = false;

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
  lines = xQueueCreate(8, sizeof(Line));
  uplink = new Uplink();   // its ring takes ~32 KB, once
}

// Wakes the net task. Kicks only go to an empty queue, so they never crowd out a Wi-Fi event.
void kick() {
  Event e{Event::Kick, 0};
  if (on_ && uxQueueMessagesWaiting(events) == 0) xQueueSend(events, &e, 0);
}

void pushLine(const std::string& s) {
  Line l;
  strlcpy(l.text, s.c_str(), sizeof l.text);
  xQueueSend(lines, &l, 0);   // full: loop() is far behind, the line is lost
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

// Core 0: the Wi-Fi connection and the posts (spec §3.1, §3.2, §3.4).
void netTask(void*) {
  // Should never happen. If it does, Wi-Fi stays off until the next reset: on_ stays set and a
  // later %TLWIFI only stores its settings.
  if (!startDriver()) {
    pushLine(wifiLine("failed", 0, -1));
    state_ = NetState::Off;
    vTaskDelete(nullptr);
  }
  bool haveWifi = false, joining = false, connected = false;
  bool leaving = false;   // our esp_wifi_disconnect()'s event is still to come
  int64_t joinAtUs = 0, joinStartUs = 0, backoffUs = kJoinMinUs;
  TickType_t wait = 0;

  auto failed = [&](int reason, int64_t now) {
    if (connected) backoffUs = kJoinMinUs;   // a drop starts the back-off over
    joining = connected = false;
    state_ = NetState::Connecting;
    pushLine(wifiLine("failed", 0, reason));
    joinAtUs = now + backoffUs;
    backoffUs = std::min(backoffUs * 2, kJoinMaxUs);
  };

  for (;;) {
    Event e;
    for (BaseType_t got = xQueueReceive(events, &e, wait); got == pdTRUE; got = xQueueReceive(events, &e, 0)) {
      int64_t now = esp_timer_get_time();
      if (e.kind == Event::Disconnected) {
        // The one after our own leave (new settings, a join timeout) is ours, whatever its reason;
        // otherwise only a join or a connection can fail.
        if (leaving) leaving = false;
        else if (joining || connected) failed(e.reason, now);
      } else if (e.kind == Event::GotIp && joining) {   // a late one from a join we gave up is no link
        joining = false;
        leaving = false;   // a new link: no leave event is still coming
        connected = true;
        backoffUs = kJoinMinUs;
        state_ = NetState::Connected;
        wifi_ap_record_t ap;
        pushLine(wifiLine("connected", esp_wifi_sta_get_ap_info(&ap) == ESP_OK ? ap.rssi : 0, 0));
        Lock lock;
        uplink->onConnected(now);
      }
    }
    wait = kIdleTicks;
    int64_t now = esp_timer_get_time();

    // New settings: leave the old network and join the new one at once (spec §3.2).
    std::string ssid, password;
    bool changed = false;
    {
      Lock lock;
      if (wifiChanged_) {
        ssid = ssid_;
        password = password_;
        wifiChanged_ = false;
        changed = true;
      }
    }
    if (changed) {
      if (joining || connected) leaving = true;   // only then does the driver report the leave
      esp_wifi_disconnect();
      wifi_config_t c = {};
      memcpy(c.sta.ssid, ssid.data(), std::min(ssid.size(), sizeof c.sta.ssid));
      memcpy(c.sta.password, password.data(), std::min(password.size(), sizeof c.sta.password));
      esp_wifi_set_config(WIFI_IF_STA, &c);
      haveWifi = true;
      joining = connected = false;
      backoffUs = kJoinMinUs;
      joinAtUs = now;
      state_ = NetState::Connecting;
    }

    if (joining && now - joinStartUs > kJoinTimeoutUs) {
      leaving = true;
      esp_wifi_disconnect();
      failed(0, now);
    }
    if (haveWifi && !joining && !connected && now >= joinAtUs) {
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
  state_ = NetState::Connecting;
  xTaskCreatePinnedToCore(netTask, "net", kStackBytes, nullptr, kPriority, nullptr, 0);
}

}  // namespace

void begin(const UplinkConfig& config, const std::string& ssid, const std::string& password) {
  init();
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
  }
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

bool nextLine(std::string& line) {
  Line l;
  if (!lines || xQueueReceive(lines, &l, 0) != pdTRUE) return false;
  line = l.text;
  return true;
}

}  // namespace net
