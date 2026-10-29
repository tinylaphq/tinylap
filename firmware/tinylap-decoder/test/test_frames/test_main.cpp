#include <unity.h>
#include <math.h>
#include <stdlib.h>
#include <vector>
#include "frames.h"
#include "tinylap_ir.h"

using namespace tinylap;
using Levels = std::vector<Level>;

void setUp() {}
void tearDown() {}

// The 10 bursts of a frame: start, 8 bits, stop.
constexpr size_t kBursts = TL_BITS + 2;

// One frame from tlEncodeFrame, in µs. Burst k is level 2k, the pause after it 2k+1.
// periodsUs overrides the 9 start-to-start periods: slot 0 is the start, 1-8 the bits.
// startJitterUs[k] moves burst k's start (taken from the pause before it, given to the pause after it);
// endJitterUs[k] lengthens or shortens burst k (taken from or given to the pause after it).
// Every level is then multiplied by scale.
static Levels train(uint8_t id, const uint16_t* periodsUs = nullptr, bool stop = true,
                    const int16_t* startJitterUs = nullptr, const int16_t* endJitterUs = nullptr,
                    double scale = 1.0) {
  uint16_t cycles[TL_LEVELS];
  tlEncodeFrame(id, cycles, TL_LEVELS);
  int32_t us[TL_LEVELS];
  for (size_t k = 0; k < TL_LEVELS; k++) us[k] = int32_t(tlCyclesToUs(cycles[k]));
  if (periodsUs)
    for (size_t k = 0; k + 1 < kBursts; k++) us[2 * k + 1] = int32_t(periodsUs[k]) - us[2 * k];
  for (size_t k = 0; k < kBursts; k++) {
    bool last = k + 1 == kBursts;
    if (startJitterUs) {
      if (k > 0) us[2 * k - 1] += startJitterUs[k];
      if (!last) us[2 * k + 1] -= startJitterUs[k];
    }
    if (endJitterUs) {
      us[2 * k] += endJitterUs[k];
      if (!last) us[2 * k + 1] -= endJitterUs[k];
    }
  }
  Levels v;
  size_t n = stop ? TL_LEVELS : TL_LEVELS - 1;
  for (size_t k = 0; k < n; k++) v.push_back({k % 2 == 0, uint16_t(lround(us[k] * scale))});
  return v;
}

static uint32_t total(const Levels& v) {
  uint32_t s = 0;
  for (auto& l : v) s += l.us;
  return s;
}

static const uint32_t kZeroUs = tlCyclesToUs(TL_BURST + TL_ZERO_PAUSE),
                      kOneUs = tlCyclesToUs(TL_BURST + TL_ONE_PAUSE),
                      kStartUs = tlCyclesToUs(TL_START_BURST + TL_START_PAUSE);

// The 9 nominal periods of id's frame, parity bit included.
static void periodsFor(uint8_t id, uint16_t* p) {
  uint8_t bits = id | uint8_t(tlParity(id) << 7);
  p[0] = uint16_t(kStartUs);
  for (int b = 0; b < TL_BITS; b++) p[b + 1] = uint16_t((bits >> b) & 1 ? kOneUs : kZeroUs);
}

void test_limits_meet_halfway() {  // spec §5.2: windows from the nominal periods, meeting halfway
  uint32_t z = tlCyclesToUs(TL_BURST + TL_ZERO_PAUSE), o = tlCyclesToUs(TL_BURST + TL_ONE_PAUSE),
           s = tlCyclesToUs(TL_START_BURST + TL_START_PAUSE);
  TEST_ASSERT_EQUAL(kLimits.zeroMax + 1, kLimits.oneMin);
  TEST_ASSERT_EQUAL(kLimits.oneMax + 1, kLimits.startMin);
  TEST_ASSERT_UINT32_WITHIN(1, (z + o) / 2, kLimits.zeroMax);
  TEST_ASSERT_UINT32_WITHIN(1, (o + s) / 2, kLimits.oneMax);
  TEST_ASSERT_EQUAL(kLimits.startMax + 8u * kLimits.oneMax + kLimits.burstMax, kLimits.frameMax);
  TEST_ASSERT_TRUE(kLimits.zeroMin <= z && kLimits.startMax >= s);
  uint32_t b = tlCyclesToUs(TL_BURST), sb = tlCyclesToUs(TL_START_BURST);
  TEST_ASSERT_TRUE(kLimits.burstMin < b && b < kLimits.burstMax);
  TEST_ASSERT_TRUE(kLimits.startBurstMin < sb && sb < kLimits.startBurstMax);
}

void test_every_id_round_trips() {
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

void test_single_bit_flip_is_parity() {
  const uint8_t ids[] = {0, 5, 0x2A, 0x55, 99, 127};
  for (uint8_t id : ids)
    for (int b = 0; b < TL_BITS; b++) {
      uint16_t p[kBursts - 1];
      periodsFor(id, p);
      p[b + 1] = uint16_t(p[b + 1] == kOneUs ? kZeroUs : kOneUs);  // 15 <-> 30 pause cycles
      Rejection r;
      TEST_ASSERT_EQUAL(0, decodeWith(p, &r));
      TEST_ASSERT_EQUAL(Reject::Parity, r.why);
    }
}

void test_jitter_and_clock_tolerance() {
  const uint8_t ids[] = {0, 0x2A, 0x55, 127};
  const double scales[] = {0.985, 1.015};
  for (uint8_t id : ids)
    for (double scale : scales)
      for (int phase = 0; phase < 2; phase++)
        for (int ends = 0; ends < 3; ends++) {  // all +132, all -132, alternating
          int16_t starts[kBursts], endsUs[kBursts];
          for (size_t k = 0; k < kBursts; k++) {
            starts[k] = int16_t((k + phase) % 2 ? 79 : -79);
            endsUs[k] = int16_t(ends == 0 ? 132 : ends == 1 ? -132 : (k + phase) % 2 ? -132 : 132);
          }
          Levels v = train(id, nullptr, true, starts, endsUs, scale);
          Frame out[4];
          Rejection r;
          TEST_ASSERT_EQUAL(1, decodeBatch(v.data(), v.size(), kLimits, out, 4, &r));
          TEST_ASSERT_EQUAL(id, out[0].id);
        }
}

void test_truncated_frames() {
  Levels v = train(42, nullptr, false);  // the first 9 bursts only
  Frame out[4];
  Rejection r;
  TEST_ASSERT_EQUAL(0, decodeBatch(v.data(), v.size(), kLimits, out, 4, &r));
  TEST_ASSERT_EQUAL(Reject::Stop, r.why);

  Levels w;  // 5 data bursts: no start burst, so no start period
  uint16_t b = uint16_t(tlCyclesToUs(TL_BURST));
  for (int k = 0; k < 5; k++) {
    w.push_back({true, b});
    if (k < 4) w.push_back({false, uint16_t(kZeroUs - b)});
  }
  TEST_ASSERT_EQUAL(0, decodeBatch(w.data(), w.size(), kLimits, out, 4, &r));
  TEST_ASSERT_EQUAL(Reject::Short, r.why);
}

void test_two_frames_gap_apart() {
  Levels a = train(0x2A);
  Levels b = train(0x55);
  Levels v = a;
  v.push_back({false, TL_GAP_MIN_US});
  v.insert(v.end(), b.begin(), b.end());
  Frame out[4];
  Rejection r;
  TEST_ASSERT_EQUAL(2, decodeBatch(v.data(), v.size(), kLimits, out, 4, &r));
  TEST_ASSERT_EQUAL(0x2A, out[0].id);
  TEST_ASSERT_EQUAL(0, out[0].offsetUs);
  TEST_ASSERT_EQUAL(0x55, out[1].id);
  TEST_ASSERT_EQUAL(total(a) + TL_GAP_MIN_US, out[1].offsetUs);
}

void test_start_burst_limits() {
  int32_t sb = int32_t(tlCyclesToUs(TL_START_BURST));
  const uint16_t bad[] = {799, 1701}, good[] = {800, 1700};
  int16_t ends[kBursts] = {};
  Frame out[4];
  Rejection r;
  for (uint16_t len : bad) {
    ends[0] = int16_t(len - sb);
    Levels v = train(0x2A, nullptr, true, nullptr, ends);
    TEST_ASSERT_EQUAL(0, decodeBatch(v.data(), v.size(), kLimits, out, 4, &r));
    TEST_ASSERT_EQUAL(Reject::Burst, r.why);
  }
  for (uint16_t len : good) {
    ends[0] = int16_t(len - sb);
    Levels v = train(0x2A, nullptr, true, nullptr, ends);
    TEST_ASSERT_EQUAL(1, decodeBatch(v.data(), v.size(), kLimits, out, 4, &r));
    TEST_ASSERT_EQUAL(0x2A, out[0].id);
  }
}

void test_limits_inside_and_outside() {
  const FrameLimits& L = kLimits;
  uint16_t p[kBursts - 1];
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
    if (b >= L.oneMin) p[8] = uint16_t(kOneUs);  // the parity bit keeps the ones even
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

// A high of the given length inside bit 3's burst (levels: start burst, start pause, then bit k's burst at 2 + 2k).
static Levels withGlitch(uint16_t glitchUs) {
  Levels v = train(0x2A);
  size_t at = 8;
  v[at] = {true, 100};
  v.insert(v.begin() + at + 1, {{false, glitchUs}, {true, uint16_t(tlCyclesToUs(TL_BURST) - 100)}});
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

void test_eight_bits_then_noise() {
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
  std::vector<bool> low(offUs + 16000, false);
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
      for (size_t off = 0; off <= 16000; off += 40) {
        Levels u = overlap(a, c, off);
        Frame out[8];
        Rejection r;
        size_t n = decodeBatch(u.data(), u.size(), kLimits, out, 8, &r);
        for (size_t k = 0; k < n; k++)
          if (out[k].id != a && out[k].id != c) third++;
      }
  TEST_ASSERT_EQUAL(0, third);
}

// Two transponders in view at once, their frames 1.2 ms apart: a bound measured below that lets both
// through; the default, above the longest pause inside a frame, lets neither (spec §5.1).
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
  TEST_ASSERT_EQUAL(2000, kLimits.silenceMin);
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
  RUN_TEST(test_limits_meet_halfway);
  RUN_TEST(test_every_id_round_trips);
  RUN_TEST(test_limits_inside_and_outside);
  RUN_TEST(test_single_bit_flip_is_parity);
  RUN_TEST(test_jitter_and_clock_tolerance);
  RUN_TEST(test_truncated_frames);
  RUN_TEST(test_two_frames_gap_apart);
  RUN_TEST(test_start_burst_limits);
  RUN_TEST(test_glitch_inside_a_bit);
  RUN_TEST(test_filter_at_the_ends);
  RUN_TEST(test_eight_bits_then_noise);
  RUN_TEST(test_two_frames_in_one_batch);
  RUN_TEST(test_overlap_is_not_a_third_id);
  RUN_TEST(test_silence_bound_is_a_parameter);
  RUN_TEST(test_noise_batch_at_capacity);
  RUN_TEST(test_batch_start);
  return UNITY_END();
}
