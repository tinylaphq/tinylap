#include "tinylap_ir.h"

uint32_t tlCyclesToUs(uint16_t cycles) {
  // cycles * 1e6 / 38000 = cycles * 1000 / 38, rounded; stays in 32 bits
  return (uint32_t(cycles) * 1000 + 19) / 38;
}

bool tlParity(uint8_t id) {
  id ^= id >> 4;
  id ^= id >> 2;
  id ^= id >> 1;
  return id & 1;
}

size_t tlEncodeFrame(uint8_t id, uint16_t* levelsCycles, size_t max) {
  if (id > 127 || max < TL_LEVELS) return 0;
  uint8_t bits = id | uint8_t(tlParity(id) << 7);
  levelsCycles[0] = TL_START_BURST;
  levelsCycles[1] = TL_START_PAUSE;
  for (uint8_t b = 0; b < TL_BITS; b++) {
    levelsCycles[2 + 2 * b] = TL_BURST;
    levelsCycles[3 + 2 * b] = (bits >> b) & 1 ? TL_ONE_PAUSE : TL_ZERO_PAUSE;
  }
  levelsCycles[2 + 2 * TL_BITS] = TL_BURST;
  return TL_LEVELS;
}
