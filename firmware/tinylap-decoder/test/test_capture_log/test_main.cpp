#include <unity.h>
#include <string>
#include "capture_log.h"

using namespace tinylap;

void setUp() {}
void tearDown() {}

static const Level kThree[] = {{true, 902}, {false, 448}, {true, 301}};

static bool endsWith(const std::string& s, const std::string& tail) {
  return s.size() >= tail.size() && s.compare(s.size() - tail.size(), tail.size(), tail) == 0;
}

void test_line_format() {
  Frame f = {42, 0};
  TEST_ASSERT_EQUAL_STRING("F t=12345678 n=3 L902 H448 L301 d=1651 id=42",
                           formatBatch(12345678, kThree, 3, &f, 1, {Reject::None, 0}).c_str());
}

void test_line_rejected() {
  struct Case { Rejection r; const char* tail; };
  const Case cases[] = {
    {{Reject::Bit, 3}, "id=? bit 3"}, {{Reject::Start, 0}, "id=? start"}, {{Reject::Stop, 0}, "id=? stop"},
    {{Reject::Short, 0}, "id=? short"}, {{Reject::Burst, 0}, "id=? burst"}, {{Reject::Long, 0}, "id=? long"},
  };
  for (const Case& c : cases) {
    std::string line = formatBatch(0, kThree, 3, nullptr, 0, c.r);
    TEST_ASSERT_TRUE_MESSAGE(endsWith(line, c.tail), line.c_str());
  }
}

void test_line_two_frames() {
  Frame f[] = {{5, 0}, {99, 9000}};
  std::string line = formatBatch(0, kThree, 3, f, 2, {Reject::None, 0});
  TEST_ASSERT_TRUE_MESSAGE(endsWith(line, " id=5,99"), line.c_str());
}

void test_summary() {
  CaptureStats s;
  Frame f = {42, 0};
  s.add(0, &f, 1);
  s.add(12000, &f, 1);
  s.add(25000, &f, 1);
  s.overflowed();
  TEST_ASSERT_EQUAL_STRING("S batches=3 overflow=1 ringlow=4096 id=42 frames=3 gap=12000..13000 mean=12500 sd=500",
                           s.summary(4096).c_str());
  TEST_ASSERT_EQUAL_STRING("S batches=0 overflow=0 ringlow=4096", s.summary(4096).c_str());
}

void test_gaps_use_frame_offsets_and_ids_ascend() {
  CaptureStats s;
  Frame a[] = {{9, 1000}, {3, 5000}};
  Frame b[] = {{9, 500}};
  s.add(0, a, 2);
  s.add(10000, b, 1);  // id 9: 1000 then 10500, gap 9500
  TEST_ASSERT_EQUAL_STRING("S batches=2 overflow=0 ringlow=10 id=3 frames=1 id=9 frames=2 gap=9500..9500 mean=9500 sd=0",
                           s.summary(10).c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_line_format);
  RUN_TEST(test_line_rejected);
  RUN_TEST(test_line_two_frames);
  RUN_TEST(test_summary);
  RUN_TEST(test_gaps_use_frame_offsets_and_ids_ascend);
  return UNITY_END();
}
