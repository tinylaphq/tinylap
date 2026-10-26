#include <unity.h>
#include <string.h>
#include <string>
#include "diag.h"

using namespace tinylap;

void setUp() {}
void tearDown() {}

static Counters sample() {
  Counters c;
  uint32_t* p = reinterpret_cast<uint32_t*>(&c);
  for (uint32_t i = 0; i < 17; i++) p[i] = i + 1;
  return c;
}

static const char* const kKeys[17] = {"batches", "frames", "rej.start", "rej.bit", "rej.stop", "rej.short",
                                      "rej.burst", "rej.long", "overflow", "ringlow", "qdrop", "pass",
                                      "single", "quiet", "minlap", "rxdrop", "suppressed"};

void test_boot_line() {
  TEST_ASSERT_EQUAL_STRING("%TLLOG boot reason=poweron fw=v0.1.0-3-gabc&", bootLine("poweron", "v0.1.0-3-gabc", nullptr).c_str());
  std::string want = "%TLLOG boot reason=panic fw=v0.1.0-3-gabc";
  for (int i = 0; i < 17; i++) want += std::string(" prev.") + kKeys[i] + "=" + std::to_string(i + 1);
  want += "&";
  Counters c = sample();
  TEST_ASSERT_EQUAL_STRING(want.c_str(), bootLine("panic", "v0.1.0-3-gabc", &c).c_str());
}

void test_stat_line() {
  std::string want = "%TLLOG stat up=600";
  for (int i = 0; i < 17; i++) {
    want += std::string(" ") + kKeys[i] + "=" + std::to_string(i + 1);
  }
  want += " heap=200000&";
  Counters c = sample();
  TEST_ASSERT_EQUAL_STRING(want.c_str(), statLine(c, 600, 200000).c_str());
}

void test_lines_fit() {
  Counters c;
  memset(&c, 0xFF, sizeof c);
  std::string fw(40, 'x');
  std::string s = statLine(c, UINT32_MAX, UINT32_MAX);
  std::string b = bootLine("brownout", fw.c_str(), &c);
  TEST_ASSERT_LESS_THAN(512, s.size());
  TEST_ASSERT_LESS_THAN(512, b.size());
  TEST_ASSERT_GREATER_THAN(100, s.size());
}

void test_pass_line() {
  CrossingEnd e{0x2A, Outcome::Passed, 8000, 8104, 8052, 9};
  TEST_ASSERT_EQUAL_STRING("%TLLOG pass id=2A t=1F74 first=1F40 last=1FA8 frames=9&", passLine(e).c_str());
}

void test_event_lines() {
  CrossingEnd e{0x2A, Outcome::Single, 8000, 8000, 8000, 1};
  TEST_ASSERT_EQUAL_STRING("%TLLOG event what=single id=2A t=1F40&", eventLine(e).c_str());
  e.outcome = Outcome::Quiet;
  TEST_ASSERT_EQUAL_STRING("%TLLOG event what=quiet id=2A t=1F40&", eventLine(e).c_str());
  e.outcome = Outcome::MinLap;
  TEST_ASSERT_EQUAL_STRING("%TLLOG event what=minlap id=2A t=1F40&", eventLine(e).c_str());
  TEST_ASSERT_EQUAL_STRING("%TLLOG event what=overflow t=10&", overflowLine(0x10).c_str());
}

void test_event_limit() {
  EventLimit l;
  for (int i = 0; i < 20; i++) TEST_ASSERT_TRUE(l.allow(1000 + i));
  TEST_ASSERT_FALSE(l.allow(5000));
  TEST_ASSERT_FALSE(l.allow(10999));
  TEST_ASSERT_TRUE(l.allow(11000));
  for (int i = 0; i < 19; i++) TEST_ASSERT_TRUE(l.allow(11001 + i));
  TEST_ASSERT_FALSE(l.allow(11100));
}

void test_saved_round_trip() {
  Counters c = sample(), out{};
  Saved s{};
  save(s, c);
  TEST_ASSERT_TRUE(restore(s, out));
  TEST_ASSERT_EQUAL_MEMORY(&c, &out, sizeof c);
  Saved flipped = s;
  flipped.c.frames ^= 1;
  TEST_ASSERT_FALSE(restore(flipped, out));
  Saved badMagic = s;
  badMagic.magic ^= 1;
  TEST_ASSERT_FALSE(restore(badMagic, out));
  Saved badSum = s;
  badSum.sum ^= 1;
  TEST_ASSERT_FALSE(restore(badSum, out));
  Saved zero{};
  TEST_ASSERT_FALSE(restore(zero, out));
}

void test_no_bad_characters() {
  std::string s = bootLine("a b", "v1 %x&y", nullptr);
  TEST_ASSERT_EQUAL_STRING("%TLLOG boot reason=a_b fw=v1__x_y&", s.c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_boot_line);
  RUN_TEST(test_stat_line);
  RUN_TEST(test_lines_fit);
  RUN_TEST(test_pass_line);
  RUN_TEST(test_event_lines);
  RUN_TEST(test_event_limit);
  RUN_TEST(test_saved_round_trip);
  RUN_TEST(test_no_bad_characters);
  return UNITY_END();
}
