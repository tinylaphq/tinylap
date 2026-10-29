#include "ir_rmt.h"
#include <Arduino.h>
#include <atomic>
#include <driver/rmt.h>
#include <freertos/ringbuf.h>

namespace ir {

static constexpr rmt_channel_t kChannel = RMT_CHANNEL_0;
static constexpr size_t kRingBytes = 8192;
static RingbufHandle_t ring = nullptr;
static std::atomic<size_t> lowWater{kRingBytes};  // written by the reading task, read by others

bool begin(int pin) {
  rmt_config_t cfg = RMT_DEFAULT_CONFIG_RX(static_cast<gpio_num_t>(pin), kChannel);
  cfg.clk_div = 80;  // 80 MHz APB / 80 = 1 µs ticks
  cfg.mem_block_num = 4;
  cfg.rx_config.filter_en = true;
  cfg.rx_config.filter_ticks_thresh = 255;  // APB ticks, the hardware maximum
  cfg.rx_config.idle_threshold = kIdleUs;   // µs of silence that ends a batch
  if (rmt_config(&cfg) != ESP_OK) return false;
  if (rmt_driver_install(kChannel, kRingBytes, 0) != ESP_OK) return false;
  if (rmt_get_ringbuf_handle(kChannel, &ring) != ESP_OK || ring == nullptr) return false;
  return rmt_rx_start(kChannel, true) == ESP_OK;
}

bool receive(Batch& out, uint32_t waitMs) {
  if (ring == nullptr) return false;  // begin() failed: no driver to read from
  size_t bytes = 0;
  // pdMS_TO_TICKS would overflow on portMAX_DELAY, which means wait forever.
  TickType_t ticks = waitMs == portMAX_DELAY ? portMAX_DELAY : pdMS_TO_TICKS(waitMs);
  auto* items = static_cast<rmt_item32_t*>(xRingbufferReceive(ring, &bytes, ticks));
  if (items == nullptr) return false;
  out.readUs = esp_timer_get_time();
  // Measured while this batch still holds its space.
  size_t freeBytes = xRingbufferGetCurFreeSize(ring);
  if (freeBytes < lowWater) lowWater = freeBytes;

  // Each item holds two levels. A zero-length half is the end marker (the idle that ended the
  // batch), not a level: drop it, so no short trailing high reaches the decoder.
  out.n = 0;
  size_t nItems = bytes / sizeof(rmt_item32_t);
  for (size_t i = 0; i < nItems; i++) {
    const rmt_item32_t& it = items[i];
    if (it.duration0 != 0 && out.n < kMaxLevels) out.levels[out.n++] = {it.level0 == 0, uint16_t(it.duration0)};
    if (it.duration1 != 0 && out.n < kMaxLevels) out.levels[out.n++] = {it.level1 == 0, uint16_t(it.duration1)};
  }
  vRingbufferReturnItem(ring, items);
  return true;
}

size_t ringLowWater() { return lowWater; }

}  // namespace ir
