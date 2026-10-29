#include <unity.h>
#include "tinylap_ir.h"

void setUp() {}
void tearDown() {}

void test_cycles_to_us() {
  TEST_ASSERT_EQUAL_UINT32(1211, tlCyclesToUs(46));
  TEST_ASSERT_EQUAL_UINT32(395, tlCyclesToUs(15));
  TEST_ASSERT_EQUAL_UINT32(789, tlCyclesToUs(30));
  TEST_ASSERT_EQUAL_UINT32(1184, tlCyclesToUs(45));
  TEST_ASSERT_EQUAL_UINT32(2000, tlCyclesToUs(76));
}
void test_parity_makes_eight_bits_even() {
  for (int id = 0; id < 128; id++) {
    int ones = __builtin_popcount(id) + (tlParity(uint8_t(id)) ? 1 : 0);
    TEST_ASSERT_EQUAL(0, ones % 2);
  }
}
void test_encode_every_id() {
  uint16_t c[TL_LEVELS];
  for (int id = 0; id < 128; id++) {
    TEST_ASSERT_EQUAL(19, tlEncodeFrame(uint8_t(id), c, TL_LEVELS));
    TEST_ASSERT_EQUAL(46, c[0]);
    TEST_ASSERT_EQUAL(30, c[1]);
    uint8_t bits = uint8_t(id) | uint8_t(tlParity(uint8_t(id)) << 7);
    for (int b = 0; b < 8; b++) {
      TEST_ASSERT_EQUAL(15, c[2 + 2 * b]);
      TEST_ASSERT_EQUAL((bits >> b) & 1 ? 30 : 15, c[3 + 2 * b]);
    }
    TEST_ASSERT_EQUAL(15, c[18]);
  }
}
void test_encode_refuses() {
  uint16_t c[TL_LEVELS];
  TEST_ASSERT_EQUAL(0, tlEncodeFrame(128, c, TL_LEVELS));
  TEST_ASSERT_EQUAL(0, tlEncodeFrame(5, c, 18));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_cycles_to_us);
  RUN_TEST(test_parity_makes_eight_bits_even);
  RUN_TEST(test_encode_every_id);
  RUN_TEST(test_encode_refuses);
  return UNITY_END();
}
