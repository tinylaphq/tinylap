#include <unity.h>
#include <stdint.h>
#include "tinylap_ir.h"
#include "transponder.h"

void setUp() {}
void tearDown() {}

void test_id_valid() {
  TEST_ASSERT_TRUE(tlIdValid(0, 0xFF));
  TEST_ASSERT_TRUE(tlIdValid(12, 0xF3));
  TEST_ASSERT_TRUE(tlIdValid(127, 0x80));
  TEST_ASSERT_FALSE(tlIdValid(0xFF, 0xFF));  // blank EEPROM
  TEST_ASSERT_FALSE(tlIdValid(0xFF, 0x00));  // 255 with its complement: above 127
  TEST_ASSERT_FALSE(tlIdValid(12, 0xFF));    // complement not written
  TEST_ASSERT_FALSE(tlIdValid(128, 0x7F));
}

void test_seed_never_zero() {
  for (int id = 0; id < 256; id++) TEST_ASSERT_NOT_EQUAL_UINT16(0, tlSeed((uint8_t)id));
}

void test_xorshift_never_zero() {
  uint16_t s = tlSeed(12);
  for (int i = 0; i < 70000; i++) TEST_ASSERT_NOT_EQUAL_UINT16(0, tlXorshift(s));
}

void test_gaps_in_range() {
  uint16_t s = tlSeed(12);
  uint16_t lo = 0xFFFF, hi = 0;
  uint32_t first = 0, last = 0;
  for (int i = 0; i < 100000; i++) {
    uint16_t g = tlNextGapUs(s);
    TEST_ASSERT_TRUE(g >= TL_GAP_MIN_US && g <= TL_GAP_MAX_US);
    if (g < lo) lo = g;
    if (g > hi) hi = g;
    if (g < TL_GAP_MIN_US + 1000) first++;
    if (g > TL_GAP_MAX_US - 1000) last++;
  }
  TEST_ASSERT_EQUAL_UINT16(TL_GAP_MIN_US, lo);
  TEST_ASSERT_EQUAL_UINT16(TL_GAP_MAX_US, hi);
  uint32_t diff = first > last ? first - last : last - first;
  TEST_ASSERT_TRUE(diff * 10 < first);
}

void test_ids_draw_different_gaps() {
  for (int a = 0; a < 128; a++)
    for (int b = a + 1; b < 128; b++) {
      uint16_t sa = tlSeed((uint8_t)a), sb = tlSeed((uint8_t)b);
      bool differ = false;
      for (int i = 0; i < 8; i++) differ |= tlNextGapUs(sa) != tlNextGapUs(sb);
      TEST_ASSERT_TRUE_MESSAGE(differ, "two ids draw the same first 8 gaps");
    }
}

void test_blink_pattern() {
  // Three 50 ms pulses, 150 ms apart, well inside the watchdog's period.
  TEST_ASSERT_EQUAL_UINT8(5, TL_BLINK_STEPS);
  uint32_t total = 0;
  for (uint8_t i = 0; i < TL_BLINK_STEPS; i++) {
    TEST_ASSERT_EQUAL_UINT16(i % 2 == 0 ? 50 : 150, tlBlinkStepMs(i));
    total += tlBlinkStepMs(i);
  }
  TEST_ASSERT_EQUAL_UINT32(450, total);
  TEST_ASSERT_TRUE(total < TL_BLINK_PERIOD_MS / 2);
  TEST_ASSERT_EQUAL_UINT16(0, tlBlinkStepMs(TL_BLINK_STEPS));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_id_valid);
  RUN_TEST(test_seed_never_zero);
  RUN_TEST(test_xorshift_never_zero);
  RUN_TEST(test_gaps_in_range);
  RUN_TEST(test_ids_draw_different_gaps);
  RUN_TEST(test_blink_pattern);
  return UNITY_END();
}
