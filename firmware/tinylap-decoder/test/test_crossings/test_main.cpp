#include <unity.h>
#include <vector>
#include "crossings.h"

using namespace tinylap;

void setUp() {}
void tearDown() {}

// Collects everything onFrame and tick return.
struct Run {
  Crossings c;
  std::vector<Passing> got;
  explicit Run(const CrossingParams& p = {}, CrossingObserver* o = nullptr) : c(p, o) {}
  void frame(uint8_t id, uint32_t t) {
    Passing out[4];
    size_t n = c.onFrame(id, t, out, 4);
    for (size_t i = 0; i < n; i++) got.push_back(out[i]);
  }
  void tick(uint32_t t) {
    Passing out[128];
    size_t n = c.tick(t, out, 128);
    for (size_t i = 0; i < n; i++) got.push_back(out[i]);
  }
  // Frames every 12 ms from `from` to `to` inclusive.
  void burst(uint8_t id, uint32_t from, uint32_t to) {
    for (uint32_t t = from; t <= to; t += 12) frame(id, t);
  }
};

static CrossingParams withStamp(Stamp s) { CrossingParams p; p.stamp = s; return p; }

void test_one_crossing_first() {
  Run r(withStamp(Stamp::First));
  r.frame(5, 1000);
  r.frame(5, 1012);
  TEST_ASSERT_EQUAL(1, r.got.size());
  TEST_ASSERT_EQUAL(5, r.got[0].id);
  TEST_ASSERT_EQUAL(1000, r.got[0].tMs);
  r.frame(5, 1024);
  r.tick(5000);
  TEST_ASSERT_EQUAL(1, r.got.size());
}

void test_one_crossing_middle() {
  Run r(withStamp(Stamp::Middle));
  for (uint32_t t = 1000; t <= 1096; t += 12) r.frame(5, t);
  TEST_ASSERT_EQUAL(0, r.got.size());
  r.tick(1096 + 150);
  TEST_ASSERT_EQUAL(1, r.got.size());
  TEST_ASSERT_EQUAL(1048, r.got[0].tMs);
}

void test_single_frame_is_nothing() {
  Run r;
  r.frame(5, 1000);
  r.tick(100000);
  TEST_ASSERT_EQUAL(0, r.got.size());
}

void test_gap_149_and_151() {
  Run a;
  a.frame(5, 1000);
  a.frame(5, 1149);
  a.tick(5000);
  TEST_ASSERT_EQUAL(1, a.got.size());
  Run b;
  b.frame(5, 1000);
  b.frame(5, 1151);
  b.tick(5000);
  TEST_ASSERT_EQUAL(0, b.got.size());
}

void test_parked_30s_is_one() {
  Run r;
  r.burst(5, 1000, 31000);
  r.tick(40000);
  TEST_ASSERT_EQUAL(1, r.got.size());
  // Goes out at the first frame 500 ms or more after the first; the stamp is the middle of the frames so far.
  uint32_t last = 1000 + 12 * ((500 + 11) / 12);  // 1504
  TEST_ASSERT_EQUAL(1000 + (last - 1000) / 2, r.got[0].tMs);
}

void test_parked_with_dropouts_is_one() {
  Run r;
  uint32_t t = 1000;
  for (int i = 0; i < 15; i++) {
    r.burst(5, t, t + 2000);
    t += 2000 + 12 + (i % 2 ? 200 : 400);
  }
  r.tick(t + 1000);
  TEST_ASSERT_EQUAL(1, r.got.size());
}

void test_lap_after_park_counts() {
  Run r;
  r.burst(5, 1000, 11000);
  r.burst(5, 14000, 14100);
  r.tick(20000);
  TEST_ASSERT_EQUAL(2, r.got.size());
}

void test_min_lap() {
  Run r(withStamp(Stamp::First));
  r.burst(5, 1000, 1100);
  r.burst(5, 1700, 1800);  // 600 ms unseen, 700 ms after the passing
  r.burst(5, 2500, 2600);  // 700 ms unseen, 1500 ms after the passing
  TEST_ASSERT_EQUAL(1, r.got.size());
  r.burst(5, 3500, 3600);  // 2500 ms after the passing
  TEST_ASSERT_EQUAL(2, r.got.size());
  TEST_ASSERT_EQUAL(3500, r.got[1].tMs);
}

void test_two_cars_interleaved() {
  Run r;
  for (uint32_t t = 1000; t <= 1096; t += 12) {
    r.frame(3, t);
    r.frame(9, t + 6);
  }
  r.tick(2000);
  TEST_ASSERT_EQUAL(2, r.got.size());
  TEST_ASSERT_TRUE(r.got[0].id != r.got[1].id);
}

void test_reset_drops_open_crossing() {
  Run r;
  r.frame(5, 1000);
  r.frame(5, 1012);
  r.c.reset();
  r.tick(5000);
  TEST_ASSERT_EQUAL(0, r.got.size());
  r.burst(5, 100, 200);
  r.tick(1000);
  TEST_ASSERT_EQUAL(1, r.got.size());
}

void test_first_crossing_right_after_boot_counts() {
  Run r;
  r.frame(5, 0);
  r.frame(5, 12);
  r.frame(5, 24);
  r.tick(500);
  TEST_ASSERT_EQUAL(1, r.got.size());
  TEST_ASSERT_EQUAL(12, r.got[0].tMs);
}

void test_frame_before_boot_is_dropped() {
  uint32_t t = 99;
  TEST_ASSERT_FALSE(toBootMs(999, 1000, &t));
  TEST_ASSERT_TRUE(toBootMs(2500, 1000, &t));
  TEST_ASSERT_EQUAL(1, t);
}

void test_128_ids() {
  Run r;
  r.burst(0, 1000, 1100);
  r.burst(127, 1000, 1100);
  r.tick(2000);
  TEST_ASSERT_EQUAL(2, r.got.size());
  TEST_ASSERT_TRUE(r.got[0].id != r.got[1].id);
}

struct Ends : CrossingObserver {
  std::vector<CrossingEnd> v;
  void ended(const CrossingEnd& e) override { v.push_back(e); }
};

void test_ends_are_reported() {
  Ends ends;
  Run r(withStamp(Stamp::Middle), &ends);
  r.burst(1, 1000, 1096);  // passes
  TEST_ASSERT_EQUAL(0, ends.v.size());
  r.tick(1096 + 150);
  TEST_ASSERT_EQUAL(1, ends.v.size());
  CrossingEnd e = ends.v[0];
  TEST_ASSERT_EQUAL(1, e.id);
  TEST_ASSERT_EQUAL(Outcome::Passed, e.outcome);
  TEST_ASSERT_EQUAL(1000, e.firstMs);
  TEST_ASSERT_EQUAL(1096, e.lastMs);
  TEST_ASSERT_EQUAL(1048, e.stampMs);
  TEST_ASSERT_EQUAL(9, e.frames);

  r.frame(2, 5000);  // a lone frame
  r.tick(6000);
  TEST_ASSERT_EQUAL(2, ends.v.size());
  TEST_ASSERT_EQUAL(Outcome::Single, ends.v[1].outcome);
  TEST_ASSERT_EQUAL(1, ends.v[1].frames);

  // A flicker inside quietMs: closed by the next frame of that id past gapMs.
  r.burst(3, 10000, 10100);
  r.frame(3, 10400);
  TEST_ASSERT_EQUAL(3, ends.v.size());  // the first crossing of id 3 ended
  TEST_ASSERT_EQUAL(Outcome::Passed, ends.v[2].outcome);
  r.tick(20000);
  TEST_ASSERT_EQUAL(4, ends.v.size());
  TEST_ASSERT_EQUAL(Outcome::Quiet, ends.v[3].outcome);

  // A crossing inside minLapMs, with the car unseen for over quietMs.
  r.burst(4, 30000, 30100);
  r.burst(4, 30800, 30900);
  r.tick(40000);
  TEST_ASSERT_EQUAL(6, ends.v.size());
  TEST_ASSERT_EQUAL(Outcome::MinLap, ends.v[5].outcome);

  // reset reports nothing.
  r.frame(6, 50000);
  r.c.reset();
  r.tick(60000);
  TEST_ASSERT_EQUAL(6, ends.v.size());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_one_crossing_first);
  RUN_TEST(test_one_crossing_middle);
  RUN_TEST(test_single_frame_is_nothing);
  RUN_TEST(test_gap_149_and_151);
  RUN_TEST(test_parked_30s_is_one);
  RUN_TEST(test_parked_with_dropouts_is_one);
  RUN_TEST(test_lap_after_park_counts);
  RUN_TEST(test_min_lap);
  RUN_TEST(test_two_cars_interleaved);
  RUN_TEST(test_reset_drops_open_crossing);
  RUN_TEST(test_first_crossing_right_after_boot_counts);
  RUN_TEST(test_frame_before_boot_is_dropped);
  RUN_TEST(test_128_ids);
  RUN_TEST(test_ends_are_reported);
  return UNITY_END();
}
