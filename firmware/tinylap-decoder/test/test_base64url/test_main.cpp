#include <unity.h>
#include <string.h>
#include <string>
#include "base64url.h"

using namespace tinylap;

void setUp() {}
void tearDown() {}

void test_decodes_wifi_fields() {
  std::string out;
  TEST_ASSERT_TRUE(base64urlDecode("T2ZmaWNlIDVHICYgQ28", out));
  TEST_ASSERT_EQUAL_STRING("Office 5G & Co", out.c_str());
  TEST_ASSERT_TRUE(base64urlDecode("cCVzcyB3w7ZyZA", out));
  TEST_ASSERT_EQUAL_STRING("p%ss w\xC3\xB6rd", out.c_str());
  TEST_ASSERT_TRUE(base64urlDecode("", out));
  TEST_ASSERT_EQUAL_size_t(0, out.size());
}

void test_keeps_nul_bytes() {
  std::string out;
  TEST_ASSERT_TRUE(base64urlDecode("AGE", out));  // 00 61
  TEST_ASSERT_EQUAL_size_t(2, out.size());
  TEST_ASSERT_EQUAL_UINT8(0, (uint8_t)out[0]);
}

void test_rejects_bad_input() {
  std::string out;
  TEST_ASSERT_FALSE(base64urlDecode("a", out));
  TEST_ASSERT_FALSE(base64urlDecode("T2ZmaWNlX", out));
  TEST_ASSERT_FALSE(base64urlDecode("ab+d", out));
  TEST_ASSERT_FALSE(base64urlDecode("ab/d", out));
  TEST_ASSERT_FALSE(base64urlDecode("abc=", out));
  TEST_ASSERT_FALSE(base64urlDecode("ab\td", out));
}

static uint32_t counter = 0;
static uint32_t next() { return counter++ * 7 + 3; }

void test_boot_id() {
  std::string a = bootId(next), b = bootId(next);
  TEST_ASSERT_EQUAL_size_t(11, a.size());
  TEST_ASSERT_EQUAL_size_t(11, b.size());
  TEST_ASSERT_TRUE(a != b);
  for (char c : a + b) TEST_ASSERT_NOT_NULL(strchr("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", c));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_decodes_wifi_fields);
  RUN_TEST(test_keeps_nul_bytes);
  RUN_TEST(test_rejects_bad_input);
  RUN_TEST(test_boot_id);
  return UNITY_END();
}
