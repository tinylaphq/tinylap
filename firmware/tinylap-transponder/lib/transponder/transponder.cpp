#include "transponder.h"
#include "tinylap_ir.h"

bool tlIdValid(uint8_t id, uint8_t complement) { return id <= 127 && complement == (uint8_t)(id ^ 0xFF); }

uint16_t tlSeed(uint8_t id) {
  uint16_t seed = (uint16_t)(0xACE1 ^ (uint16_t)(id * 0x9E37));
  return seed ? seed : 0xACE1;
}

uint16_t tlXorshift(uint16_t& state) {
  state ^= (uint16_t)(state << 7);
  state ^= (uint16_t)(state >> 9);
  state ^= (uint16_t)(state << 8);
  return state;
}

uint16_t tlNextGapUs(uint16_t& state) {
  constexpr uint16_t span = TL_GAP_MAX_US - TL_GAP_MIN_US + 1;  // 16001
  constexpr uint16_t limit = 4 * span;                          // 64004: a multiple of span, so no value is favoured
  uint16_t value;
  do value = tlXorshift(state);
  while (value >= limit);
  return (uint16_t)(TL_GAP_MIN_US + value % span);
}

uint16_t tlBlinkStepMs(uint8_t step) {
  if (step >= TL_BLINK_STEPS) return 0;
  return step % 2 == 0 ? 50 : 150;
}
