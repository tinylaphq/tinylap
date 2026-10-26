#include <unity.h>
#include <stdlib.h>
#include <vector>
#include "frames.h"

using namespace tinylap;
using Levels = std::vector<Level>;

void setUp() {}
void tearDown() {}

static void burst(Levels& v, uint16_t burstUs, uint16_t periodUs) {
  v.push_back({true, burstUs});
  v.push_back({false, uint16_t(periodUs - burstUs)});
}

// One frame: start burst, 7 bits (LSB first), stop burst. Periods can be overridden per slot:
// slot 0 is the start, 1-7 the bits.
static Levels train(uint8_t id, const uint16_t* periods = nullptr, bool stop = true) {
  Levels v;
  burst(v, 900, periods ? periods[0] : 1350);
  for (int b = 0; b < 7; b++) {
    uint16_t p = periods ? periods[b + 1] : ((id >> b) & 1 ? 900 : 600);
    burst(v, 300, p);
  }
  if (stop) v.push_back({true, 300});
  return v;
}

static uint32_t total(const Levels& v) {
  uint32_t s = 0;
  for (auto& l : v) s += l.us;
  return s;
}

static void periodsFor(uint8_t id, uint16_t* p) {
  p[0] = 1350;
  for (int b = 0; b < 7; b++) p[b + 1] = (id >> b) & 1 ? 900 : 600;
}

void test_every_id_decodes() {
  for (int id = 0; id < 128; id++) {
    Levels v = train(uint8_t(id));
    Frame out[4];
    Rejection r;
    TEST_ASSERT_EQUAL(1, decodeBatch(v.data(), v.size(), kLimits, out, 4, &r));
    TEST_ASSERT_EQUAL(id, out[0].id);
    TEST_ASSERT_EQUAL(0, out[0].offsetUs);
  }
}

static size_t decodeWith(uint16_t* p, Rejection* r) {
  Levels v = train(0, p);
  Frame out[4];
  return decodeBatch(v.data(), v.size(), kLimits, out, 4, r);
}

void test_limits_inside_and_outside() {
  const FrameLimits& L = kLimits;
  uint16_t p[8];
  Rejection r;
  uint16_t okStart[] = {L.startMin, L.startMax};
  for (uint16_t s : okStart) {
    periodsFor(0, p);
    p[0] = s;
    TEST_ASSERT_EQUAL(1, decodeWith(p, &r));
  }
  uint16_t okBit[] = {L.oneMin, L.oneMax, L.zeroMin, L.zeroMax};
  for (uint16_t b : okBit) {
    periodsFor(0, p);
    p[4] = b;
    TEST_ASSERT_EQUAL(1, decodeWith(p, &r));
  }
  uint16_t badStart[] = {uint16_t(L.startMin - 1), uint16_t(L.startMax + 1)};
  for (uint16_t s : badStart) {
    periodsFor(0, p);
    p[0] = s;
    TEST_ASSERT_EQUAL(0, decodeWith(p, &r));
    TEST_ASSERT_EQUAL(Reject::Start, r.why);
  }
  uint16_t badBit[] = {uint16_t(L.oneMax + 1), uint16_t(L.zeroMin - 1)};
  for (uint16_t b : badBit) {
    periodsFor(0, p);
    p[4] = b;  // the third bit
    TEST_ASSERT_EQUAL(0, decodeWith(p, &r));
    TEST_ASSERT_EQUAL(Reject::Bit, r.why);
    TEST_ASSERT_EQUAL(3, r.bit);
  }
}

void test_missing_stop() {
  Levels v = train(42, nullptr, false);
  Frame out[4];
  Rejection r;
  TEST_ASSERT_EQUAL(0, decodeBatch(v.data(), v.size(), kLimits, out, 4, &r));
  TEST_ASSERT_EQUAL(Reject::Stop, r.why);
}

// A high of the given length inside bit 3's burst (levels: start burst, start pause, then bit k's burst at 2 + 2k).
static Levels withGlitch(uint16_t glitchUs) {
  Levels v = train(0x2A);
  size_t at = 8;
  v[at] = {true, 100};
  v.insert(v.begin() + at + 1, {{false, glitchUs}, {true, uint16_t(200)}});
  return v;
}

void test_glitch_inside_a_bit() {
  Frame out[4];
  Rejection r;
  Levels v = withGlitch(60);
  size_t n = filterGlitches(v.data(), v.size(), 100);
  TEST_ASSERT_EQUAL(1, decodeBatch(v.data(), n, kLimits, out, 4, &r));
  TEST_ASSERT_EQUAL(0x2A, out[0].id);

  Levels w = withGlitch(150);
  n = filterGlitches(w.data(), w.size(), 100);
  TEST_ASSERT_EQUAL(0, decodeBatch(w.data(), n, kLimits, out, 4, &r));
  TEST_ASSERT_EQUAL(Reject::Bit, r.why);
  TEST_ASSERT_EQUAL(3, r.bit);
}

void test_filter_at_the_ends() {
  Level a[] = {{false, 50}, {true, 300}, {false, 500}, {true, 40}};
  size_t n = filterGlitches(a, 4, 100);
  TEST_ASSERT_EQUAL(2, n);
  TEST_ASSERT_TRUE(a[0].low);
  TEST_ASSERT_EQUAL(350, a[0].us);
  TEST_ASSERT_FALSE(a[1].low);
  TEST_ASSERT_EQUAL(540, a[1].us);
}

void test_seven_bits_then_noise() {
  Levels v = train(0x55, nullptr, false);
  v.push_back({true, 77});
  v.push_back({false, 2000});
  v.push_back({true, 3000});
  v.push_back({false, 20});
  Frame out[4];
  Rejection r;
  TEST_ASSERT_EQUAL(0, decodeBatch(v.data(), v.size(), kLimits, out, 4, &r));
}

void test_two_frames_in_one_batch() {
  Levels a = train(5);
  Levels b = train(99);
  Levels v = a;
  v.push_back({false, 2000});
  v.insert(v.end(), b.begin(), b.end());
  Frame out[4];
  Rejection r;
  TEST_ASSERT_EQUAL(2, decodeBatch(v.data(), v.size(), kLimits, out, 4, &r));
  TEST_ASSERT_EQUAL(5, out[0].id);
  TEST_ASSERT_EQUAL(99, out[1].id);
  TEST_ASSERT_EQUAL(total(a) + 2000, out[1].offsetUs);
}

// ORs two frames' carrier (the second shifted by offUs), as two transponders seen at once.
static Levels overlap(uint8_t a, uint8_t c, size_t offUs) {
  Levels x = train(a), y = train(c);
  std::vector<bool> low(offUs + 10000, false);
  size_t t = 0;
  for (auto& l : x) {
    if (l.low) for (size_t k = 0; k < l.us; k++) low[t + k] = true;
    t += l.us;
  }
  t = offUs;
  for (auto& l : y) {
    if (l.low) for (size_t k = 0; k < l.us; k++) low[t + k] = true;
    t += l.us;
  }
  Levels u;
  for (size_t k = 0; k < low.size();) {
    size_t j = k;
    while (j < low.size() && low[j] == low[k]) j++;
    u.push_back({low[k], uint16_t(j - k)});
    k = j;
  }
  return u;
}

void test_overlap_is_not_a_third_id() {
  const uint8_t ids[] = {0, 5, 0x2A, 0x55, 99, 127};
  size_t third = 0;
  for (uint8_t a : ids)
    for (uint8_t c : ids)
      for (size_t off = 0; off <= 8000; off += 40) {
        Levels u = overlap(a, c, off);
        Frame out[8];
        Rejection r;
        size_t n = decodeBatch(u.data(), u.size(), kLimits, out, 8, &r);
        for (size_t k = 0; k < n; k++)
          if (out[k].id != a && out[k].id != c) third++;
      }
  // No checksum: two ids (85 with 99, aligned, both orders) still read as 101. Ghost risk, spec §5.1.
  TEST_ASSERT_EQUAL(2, third);
}

// Two transponders in view at once, their frames 1.2 ms apart: a bound measured below that lets both
// through; the safe default lets neither (spec §4.3, §5.1).
void test_silence_bound_is_a_parameter() {
  Levels v = train(5);
  v.push_back({false, 1200});
  Levels b = train(99);
  v.insert(v.end(), b.begin(), b.end());
  Frame out[4];
  Rejection r;
  FrameLimits measured = kLimits;
  measured.silenceMin = 1000;
  TEST_ASSERT_EQUAL(2, decodeBatch(v.data(), v.size(), measured, out, 4, &r));
  TEST_ASSERT_EQUAL(5, out[0].id);
  TEST_ASSERT_EQUAL(99, out[1].id);
  TEST_ASSERT_EQUAL(1550, kLimits.silenceMin);
  TEST_ASSERT_EQUAL(0, decodeBatch(v.data(), v.size(), kLimits, out, 4, &r));
}

void test_noise_batch_at_capacity() {
  srand(12345);
  Levels v;
  for (int k = 0; k < 512; k++) v.push_back({k % 2 == 0, uint16_t(20 + rand() % 2981)});
  Frame out[16];
  Rejection r;
  size_t n = filterGlitches(v.data(), v.size(), kLimits.glitchMax);
  TEST_ASSERT_EQUAL(0, decodeBatch(v.data(), n, kLimits, out, 16, &r));
  Levels w;
  srand(12345);
  for (int k = 0; k < 512; k++) w.push_back({k % 2 == 1, uint16_t(20 + rand() % 2981)});
  TEST_ASSERT_EQUAL(0, decodeBatch(w.data(), w.size(), kLimits, out, 16, &r));
}

void test_batch_start() {
  Levels v = train(7);
  TEST_ASSERT_EQUAL_INT64(1000000 - int64_t(total(v)) - 2500,
                          batchStartUs(1000000, v.data(), v.size(), 2500));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_every_id_decodes);
  RUN_TEST(test_limits_inside_and_outside);
  RUN_TEST(test_missing_stop);
  RUN_TEST(test_glitch_inside_a_bit);
  RUN_TEST(test_filter_at_the_ends);
  RUN_TEST(test_seven_bits_then_noise);
  RUN_TEST(test_two_frames_in_one_batch);
  RUN_TEST(test_overlap_is_not_a_third_id);
  RUN_TEST(test_silence_bound_is_a_parameter);
  RUN_TEST(test_noise_batch_at_capacity);
  RUN_TEST(test_batch_start);
  return UNITY_END();
}
