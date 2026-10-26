#include <unity.h>
#include <string>
#include <vector>
#include "base64url.h"
#include "session.h"

using namespace tinylap;

void setUp() {}
void tearDown() {}

static uint32_t counter = 0;
static uint32_t nextRandom() { return counter++; }

struct FakeStore : Store {
  bool has = false, fail = false;
  std::string decoder, token, ssid, password;
  int pairings = 0, wifis = 0;
  bool load(std::string& d, std::string& t) override {
    if (!has) return false;
    d = decoder; t = token;
    return true;
  }
  bool savePairing(const std::string& d, const std::string& t) override {
    if (fail) return false;
    has = true; decoder = d; token = t; pairings++;
    return true;
  }
  bool saveWifi(const std::string& s, const std::string& p) override {
    if (fail) return false;
    ssid = s; password = p; wifis++;
    return true;
  }
};

struct Lines : Sink {
  std::vector<std::string> got;
  void write(const std::string& l) override { got.push_back(l); }
};

struct Rig {
  FakeStore store;
  Lines out;
  std::vector<bool> boots;
  std::vector<std::string> sinkAtBoot;   // what the sink held when onBoot ran
  Session* s = nullptr;
  Rig() { counter = 0; }
  ~Rig() { delete s; }
  void start(int64_t nowUs = 0) {
    s = new Session(store, nextRandom, out, [this](bool on) {
      boots.push_back(on);
      sinkAtBoot.push_back(out.got.empty() ? "" : out.got.back());
    });
    s->begin(nowUs);
    out.got.clear();
  }
  void send(const std::string& m, int64_t nowUs = 0) { s->onBytes(m.data(), m.size(), nowUs); }
};

static const std::string kToken(43, 'T');
static const std::string kToken2(43, 'U');

static std::string b64(const std::string& in) {
  static const char* a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  std::string o;
  size_t i = 0;
  for (; i + 2 < in.size(); i += 3) {
    uint32_t v = ((uint8_t)in[i] << 16) | ((uint8_t)in[i + 1] << 8) | (uint8_t)in[i + 2];
    o += a[v >> 18]; o += a[(v >> 12) & 63]; o += a[(v >> 6) & 63]; o += a[v & 63];
  }
  if (in.size() - i == 1) {
    uint32_t v = (uint8_t)in[i] << 16;
    o += a[v >> 18]; o += a[(v >> 12) & 63];
  } else if (in.size() - i == 2) {
    uint32_t v = ((uint8_t)in[i] << 16) | ((uint8_t)in[i + 1] << 8);
    o += a[v >> 18]; o += a[(v >> 12) & 63]; o += a[(v >> 6) & 63];
  }
  return o;
}
static std::string wifi(const std::string& ssid, const std::string& pw) {
  return "%TLWIFI " + b64(ssid) + " " + b64(pw) + "&";
}

static void test_begin_unpaired_and_paired() {
  Rig a;
  a.start();
  TEST_ASSERT_EQUAL(1, a.boots.size());
  TEST_ASSERT_TRUE(a.boots[0]);
  TEST_ASSERT_EQUAL_STRING(("%TLID - " + a.s->boot() + "&").c_str(), a.sinkAtBoot[0].c_str());
  TEST_ASSERT_EQUAL(11, a.s->boot().size());

  Rig b;
  b.store.has = true; b.store.decoder = "dec_1"; b.store.token = kToken;
  b.start();
  TEST_ASSERT_EQUAL_STRING(("%TLID dec_1 " + b.s->boot() + "&").c_str(), b.sinkAtBoot[0].c_str());
}

static void test_bad_stored_id_is_unpaired() {
  Rig a;
  a.store.has = true; a.store.decoder = "bad id!"; a.store.token = kToken;
  a.start();
  TEST_ASSERT_EQUAL_STRING(("%TLID - " + a.s->boot() + "&").c_str(), a.sinkAtBoot[0].c_str());
}

static void test_startup_acks() {
  Rig a; a.start();
  a.send("%C&");
  TEST_ASSERT_EQUAL(1, a.out.got.size());
  TEST_ASSERT_EQUAL_STRING("%A&", a.out.got[0].c_str());
}

static void test_hello() {
  Rig a; a.start();
  a.send("%TLHELLO&");
  TEST_ASSERT_EQUAL(1, a.out.got.size());
  TEST_ASSERT_EQUAL_STRING(("%TLID - " + a.s->boot() + "&").c_str(), a.out.got[0].c_str());
}

static void test_reset_new_boot() {
  Rig a;
  a.store.has = true; a.store.decoder = "dec_1"; a.store.token = kToken;
  a.start();
  std::string before = a.s->boot();
  a.send("%I&", 4000000);
  TEST_ASSERT_EQUAL(2, a.boots.size());
  TEST_ASSERT_FALSE(a.boots[1]);
  TEST_ASSERT_EQUAL(1, a.out.got.size());
  TEST_ASSERT_TRUE(a.s->boot() != before);
  TEST_ASSERT_EQUAL(4000000, (long)a.s->bootStartUs());
  TEST_ASSERT_EQUAL_STRING(("%TLID dec_1 " + a.s->boot() + "&").c_str(), a.out.got[0].c_str());
  TEST_ASSERT_EQUAL_STRING(a.out.got[0].c_str(), a.sinkAtBoot[1].c_str());
}

static void test_pair() {
  Rig a; a.start();
  a.send("%TLPAIR dec_1 " + kToken + "&");
  TEST_ASSERT_EQUAL(1, a.out.got.size());
  TEST_ASSERT_EQUAL_STRING("%TLOK&", a.out.got[0].c_str());
  TEST_ASSERT_EQUAL_STRING("dec_1", a.store.decoder.c_str());
  TEST_ASSERT_EQUAL_STRING(kToken.c_str(), a.store.token.c_str());
  a.out.got.clear();
  a.send("%TLHELLO&");
  TEST_ASSERT_EQUAL_STRING(("%TLID dec_1 " + a.s->boot() + "&").c_str(), a.out.got[0].c_str());
  a.out.got.clear();

  a.send("%TLPAIR dec_2 " + kToken2 + "&");
  TEST_ASSERT_EQUAL_STRING("dec_2", a.store.decoder.c_str());
  a.out.got.clear();
  a.send("%TLHELLO&");
  TEST_ASSERT_EQUAL_STRING(("%TLID dec_2 " + a.s->boot() + "&").c_str(), a.out.got[0].c_str());
  a.out.got.clear();

  a.store.fail = true;
  a.send("%TLPAIR dec_3 " + kToken + "&");
  TEST_ASSERT_EQUAL_STRING("%TLERR store&", a.out.got[0].c_str());
  a.out.got.clear();
  a.send("%TLHELLO&");
  TEST_ASSERT_EQUAL_STRING(("%TLID dec_2 " + a.s->boot() + "&").c_str(), a.out.got[0].c_str());
}

static void expectReply(Rig& a, const std::string& msg, const char* reply) {
  a.out.got.clear();
  a.send(msg);
  TEST_ASSERT_EQUAL(1, a.out.got.size());
  TEST_ASSERT_EQUAL_STRING(reply, a.out.got[0].c_str());
}

static void test_wifi_bounds() {
  Rig a; a.start();
  expectReply(a, wifi("", "password"), "%TLERR Wi-Fi name too long&");
  expectReply(a, wifi(std::string(33, 's'), "password"), "%TLERR Wi-Fi name too long&");
  expectReply(a, wifi("net", std::string(7, 'p')), "%TLERR Wi-Fi password length&");
  expectReply(a, wifi("net", std::string(64, 'g')), "%TLERR Wi-Fi password length&");
  TEST_ASSERT_EQUAL(0, a.store.wifis);
  expectReply(a, wifi("net", ""), "%TLOK&");
  expectReply(a, wifi("net", std::string(8, 'p')), "%TLOK&");
  expectReply(a, wifi("net", std::string(63, 'p')), "%TLOK&");
  expectReply(a, wifi(std::string(32, 's'), std::string(64, 'a') ), "%TLOK&");
  expectReply(a, wifi("net", std::string(32, 'A') + std::string(32, '0')), "%TLOK&");
  TEST_ASSERT_EQUAL(5, a.store.wifis);
  a.store.fail = true;
  expectReply(a, wifi("net", "password"), "%TLERR store&");
}

static void test_wifi_bytes_reach_the_store_exactly() {
  Rig a; a.start();
  const std::string ssid("a\0b\xC3\xA9", 5);
  expectReply(a, wifi(ssid, ""), "%TLOK&");
  TEST_ASSERT_EQUAL(5, a.store.ssid.size());
  TEST_ASSERT_EQUAL_MEMORY(ssid.data(), a.store.ssid.data(), 5);
}

static void test_longest_pairing_round_trips() {
  Rig a; a.start();
  std::string id(64, 'd');
  expectReply(a, "%TLPAIR " + id + " " + kToken + "&", "%TLOK&");
  TEST_ASSERT_EQUAL_STRING(id.c_str(), a.store.decoder.c_str());
  TEST_ASSERT_EQUAL_STRING(kToken.c_str(), a.store.token.c_str());
  expectReply(a, "%TLHELLO&", ("%TLID " + id + " " + a.s->boot() + "&").c_str());
}

static void test_stop_and_unknown_are_silent() {
  Rig a; a.start();
  a.send("%F&");
  a.send("%XYZ&");
  TEST_ASSERT_EQUAL(0, a.out.got.size());
}

static void test_clock() {
  Rig a; a.start(0);
  a.s->tick(999000);
  TEST_ASSERT_EQUAL(0, a.out.got.size());
  a.s->tick(1000000);
  TEST_ASSERT_EQUAL(1, a.out.got.size());
  TEST_ASSERT_EQUAL_STRING("%T3E8&", a.out.got[0].c_str());
  a.out.got.clear();
  a.s->tick(3500000);
  TEST_ASSERT_EQUAL(2, a.out.got.size());
  TEST_ASSERT_EQUAL_STRING("%T7D0&", a.out.got[0].c_str());
  TEST_ASSERT_EQUAL_STRING("%TBB8&", a.out.got[1].c_str());
  a.out.got.clear();
  a.send("%I&", 4000000);
  a.out.got.clear();
  a.s->tick(4999000);
  TEST_ASSERT_EQUAL(0, a.out.got.size());
  a.s->tick(5000000);
  TEST_ASSERT_EQUAL(1, a.out.got.size());
  TEST_ASSERT_EQUAL_STRING("%T3E8&", a.out.got[0].c_str());
}

static void test_passing_line() {
  Rig a; a.start();
  a.s->onPassing({42, 1000});
  TEST_ASSERT_EQUAL(1, a.out.got.size());
  TEST_ASSERT_EQUAL_STRING("%L2A,3E8&", a.out.got[0].c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_begin_unpaired_and_paired);
  RUN_TEST(test_bad_stored_id_is_unpaired);
  RUN_TEST(test_startup_acks);
  RUN_TEST(test_hello);
  RUN_TEST(test_reset_new_boot);
  RUN_TEST(test_pair);
  RUN_TEST(test_wifi_bounds);
  RUN_TEST(test_wifi_bytes_reach_the_store_exactly);
  RUN_TEST(test_longest_pairing_round_trips);
  RUN_TEST(test_stop_and_unknown_are_silent);
  RUN_TEST(test_clock);
  RUN_TEST(test_passing_line);
  return UNITY_END();
}
