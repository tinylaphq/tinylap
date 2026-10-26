// The capture build: logs every receiver batch, to measure the transponders (spec §4).
#include <Arduino.h>
#include "capture_log.h"
#include "frames.h"
#include "ir_rmt.h"

using namespace tinylap;

// decodeBatch's arrays run on loop()'s stack; Arduino's default 8 KB leaves too little margin.
SET_LOOP_TASK_STACK_SIZE(12 * 1024);

static ir::Batch batch;
static Level work[ir::kMaxLevels];
static Frame frames[16];
static CaptureStats stats;
static uint32_t lastSummaryMs = 0;

void setup() {
  Serial.setTxBufferSize(8192);
  Serial.begin(921600);
  if (!ir::begin(4)) Serial.println("E ir begin failed");
  lastSummaryMs = millis();
}

void loop() {
  if (ir::receive(batch, 100)) {
    // The raw levels are logged as they came; a working copy is filtered and decoded.
    size_t n = batch.n;
    for (size_t i = 0; i < n; i++) work[i] = batch.levels[i];
    n = filterGlitches(work, n, kLimits.glitchMax);
    Rejection first = {Reject::None, 0};
    size_t found = decodeBatch(work, n, kLimits, frames, 16, &first);
    int64_t startUs = batchStartUs(batch.readUs, batch.levels, batch.n, ir::kIdleUs);
    Serial.println(formatBatch(startUs, batch.levels, batch.n, frames, found, first).c_str());
    stats.add(startUs, frames, found);
    if (batch.n == ir::kMaxLevels) stats.overflowed();
  }
  if (millis() - lastSummaryMs >= 5000) {
    lastSummaryMs += 5000;
    Serial.println(stats.summary(ir::ringLowWater()).c_str());
  }
}
