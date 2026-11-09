#include <unity.h>
#include <cstdint>
#include <string>
#include <vector>
#include "uplink.h"

using namespace tinylap;

void setUp() {}
void tearDown() {}

static const int64_t kS = 1000000;
static const std::string kToken(43, 'T');
static const std::string kToken2(43, 'U');

static bool has(const std::string& s, const std::string& part) { return s.find(part) != std::string::npos; }

static void ready(Uplink& u, const std::string& boot = "b00tb00t") {
  u.configure({"https://x", "d1", kToken});
  u.onBoot(boot, 0);
}

static void test_passing_goes_out_at_once() {
  Uplink u; ready(u);
  u.onPassing("2A", 81234, 81234000);
  Request r;
  TEST_ASSERT_TRUE(u.next(81234000, r));
  TEST_ASSERT_EQUAL_STRING("https://x/decoders/d1/passings", r.url.c_str());
  TEST_ASSERT_EQUAL_STRING(("Bearer " + kToken).c_str(), r.auth.c_str());
  TEST_ASSERT_TRUE(has(r.body, "\"boot\":\"b00tb00t\""));
  TEST_ASSERT_TRUE(has(r.body, "{\"transponder\":\"2A\",\"t\":81234}"));
  TEST_ASSERT_TRUE(has(r.body, "\"now\":81234"));
  TEST_ASSERT_EQUAL(1, u.waiting());
}

static void test_trailing_slash_on_server() {
  Uplink u;
  u.configure({"http://10.0.0.2:8080/", "d1", kToken});
  u.onBoot("b00tb00t", 0);
  u.onPassing("2A", 1, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  TEST_ASSERT_EQUAL_STRING("http://10.0.0.2:8080/decoders/d1/passings", r.url.c_str());
}

static void test_one_request_in_flight() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  u.onPassing("2B", 2000, 0);
  TEST_ASSERT_FALSE(u.next(0, r));
  u.answer(200, "{\"stored\":1,\"duplicates\":0,\"through\":1000}", 0);
  TEST_ASSERT_TRUE(u.next(0, r));
  TEST_ASSERT_TRUE(has(r.body, "\"t\":2000"));
  TEST_ASSERT_FALSE(has(r.body, "\"t\":1000"));
}

static void test_answer_drops_only_what_the_batch_carried_and_through_covers() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  u.onPassing("2B", 2000, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  u.onPassing("2C", 3000, 0);
  u.answer(200, "{\"stored\":2,\"duplicates\":0,\"through\":1500}", 0);
  TEST_ASSERT_EQUAL(2, u.waiting());
  TEST_ASSERT_EQUAL(200, u.lastStatus());
  // A through above a passing the batch never carried leaves it in.
  TEST_ASSERT_TRUE(u.next(0, r));
  u.onPassing("2D", 500, 0);
  u.answer(200, "{\"stored\":2,\"duplicates\":0,\"through\":9000}", 0);
  TEST_ASSERT_EQUAL(1, u.waiting());
}

static void test_older_boot_goes_first_without_now() {
  Uplink u; ready(u, "bootAAAA");
  u.onPassing("2A", 1000, 1 * kS);
  u.onPassing("2B", 2000, 2 * kS);
  u.onBoot("bootBBBB", 3 * kS);
  u.onPassing("2A", 500, 3500000);
  Request r;
  TEST_ASSERT_TRUE(u.next(4 * kS, r));
  TEST_ASSERT_TRUE(has(r.body, "\"boot\":\"bootAAAA\""));
  TEST_ASSERT_FALSE(has(r.body, "\"now\""));
  TEST_ASSERT_FALSE(has(r.body, "\"t\":500"));
  u.answer(200, "{\"stored\":2,\"duplicates\":0,\"through\":2000}", 4 * kS);
  TEST_ASSERT_EQUAL(1, u.waiting());
  TEST_ASSERT_TRUE(u.next(5 * kS, r));
  TEST_ASSERT_TRUE(has(r.body, "\"boot\":\"bootBBBB\""));
  TEST_ASSERT_TRUE(has(r.body, "\"now\":2000"));
  TEST_ASSERT_TRUE(has(r.body, "{\"transponder\":\"2A\",\"t\":500}"));
}

static void test_fifth_boot_drops_the_oldest() {
  Uplink u; ready(u, "boot0000");
  u.onPassing("2A", 1, 0);
  u.onPassing("2A", 2, 0);
  u.onBoot("boot1111", 0); u.onPassing("2A", 3, 0);
  u.onBoot("boot2222", 0); u.onPassing("2A", 4, 0);
  u.onBoot("boot3333", 0); u.onPassing("2A", 5, 0);
  TEST_ASSERT_EQUAL(0, u.dropped());
  u.onBoot("boot4444", 0); u.onPassing("2A", 6, 0);
  TEST_ASSERT_EQUAL(2, u.dropped());
  TEST_ASSERT_EQUAL(4, u.waiting());
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  TEST_ASSERT_TRUE(has(r.body, "\"boot\":\"boot1111\""));
}

static void test_full_outbox_drops_the_oldest() {
  Uplink u; ready(u);
  for (uint32_t i = 0; i < 2001; i++) u.onPassing("2A", 1000 + i, 0);
  TEST_ASSERT_EQUAL(2000, u.waiting());
  TEST_ASSERT_EQUAL(1, u.dropped());
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  TEST_ASSERT_TRUE(has(r.body, "\"passings\":[{\"transponder\":\"2A\",\"t\":1001}"));
}

static void test_batch_holds_at_most_500() {
  Uplink u; ready(u);
  for (uint32_t i = 0; i < 501; i++) u.onPassing("2A", 1000 + i, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  TEST_ASSERT_TRUE(has(r.body, "\"t\":1499}"));
  TEST_ASSERT_FALSE(has(r.body, "\"t\":1500}"));
  u.answer(200, "{\"stored\":500,\"duplicates\":0,\"through\":1499}", 0);
  TEST_ASSERT_EQUAL(1, u.waiting());
}

static void test_401_pauses_until_configure_gives_a_new_token() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  u.answer(401, "", 0);
  TEST_ASSERT_TRUE(u.paused());
  u.onPassing("2B", 2000, 0);
  TEST_ASSERT_FALSE(u.next(100 * kS, r));
  u.configure({"https://x", "d1", kToken});
  TEST_ASSERT_TRUE(u.paused());
  TEST_ASSERT_FALSE(u.next(100 * kS, r));
  u.configure({"https://x", "d1", kToken2});
  TEST_ASSERT_FALSE(u.paused());
  TEST_ASSERT_EQUAL(2, u.waiting());
  TEST_ASSERT_TRUE(u.next(100 * kS, r));
  TEST_ASSERT_EQUAL_STRING(("Bearer " + kToken2).c_str(), r.auth.c_str());
}

static void test_404_and_422_drop_the_batch() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  u.onPassing("2B", 2000, 0);
  u.answer(404, "", 0);
  TEST_ASSERT_EQUAL(1, u.waiting());
  TEST_ASSERT_TRUE(u.next(0, r));
  u.answer(422, "{\"error\":\"x\"}", 0);
  TEST_ASSERT_EQUAL(0, u.waiting());
  TEST_ASSERT_EQUAL(422, u.lastStatus());
  TEST_ASSERT_EQUAL(0, u.dropped());
}

static void test_429_waits_retry_after() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  u.answer(429, "", 10 * kS, 5);
  TEST_ASSERT_FALSE(u.next(15 * kS - 1, r));
  TEST_ASSERT_TRUE(u.next(15 * kS, r));
  TEST_ASSERT_EQUAL(1, u.waiting());
}

static void test_backoff_doubles_to_30_s_and_resets_on_200() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  Request r;
  int64_t now = 0;
  TEST_ASSERT_TRUE(u.next(now, r));
  const int64_t waits[] = {1, 2, 4, 8, 16, 30, 30};
  for (size_t i = 0; i < 7; i++) {
    const int64_t w = waits[i];
    u.answer(i % 2 ? 503 : 0, "", now);   // a timeout and a server error count alike
    TEST_ASSERT_FALSE(u.next(now + w * kS - 1, r));
    now += w * kS;
    TEST_ASSERT_TRUE(u.next(now, r));
  }
  TEST_ASSERT_EQUAL(0, u.lastStatus());
  u.answer(200, "{\"stored\":0,\"duplicates\":1,\"through\":0}", now);
  TEST_ASSERT_EQUAL(1, u.waiting());
  TEST_ASSERT_TRUE(u.next(now, r));
  u.answer(500, "", now);
  TEST_ASSERT_FALSE(u.next(now + kS - 1, r));
  TEST_ASSERT_TRUE(u.next(now + kS, r));
}

static void test_429_retry_after_is_at_most_an_hour() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  u.answer(429, "", 0, INT64_MAX / 1000);
  TEST_ASSERT_FALSE(u.next(3600 * kS - 1, r));
  TEST_ASSERT_TRUE(u.next(3600 * kS, r));
}

static void test_200_without_through_backs_off() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  u.answer(200, "<html>Sign in to the hotel Wi-Fi</html>", 0);
  TEST_ASSERT_EQUAL(1, u.waiting());
  TEST_ASSERT_FALSE(u.next(kS - 1, r));
  TEST_ASSERT_TRUE(u.next(kS, r));
  u.answer(200, "{\"stored\":0,\"duplicates\":0,\"through\":null}", kS);
  TEST_ASSERT_FALSE(u.next(3 * kS - 1, r));
  TEST_ASSERT_TRUE(u.next(3 * kS, r));
}

static void test_reconnecting_ends_the_backoff() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  Request r;
  int64_t now = 0;
  for (int i = 0; i < 5; i++) {
    TEST_ASSERT_TRUE(u.next(now, r));
    u.answer(0, "", now);
    now += 30 * kS;
  }
  TEST_ASSERT_TRUE(u.next(now, r));
  u.answer(0, "", now);
  TEST_ASSERT_FALSE(u.next(now + kS, r));
  u.onConnected(now + kS);
  TEST_ASSERT_TRUE(u.next(now + kS, r));
  u.answer(0, "", now + kS);   // and the back-off starts again at 1 s
  TEST_ASSERT_FALSE(u.next(now + 2 * kS - 1, r));
  TEST_ASSERT_TRUE(u.next(now + 2 * kS, r));
  u.answer(401, "", now + 2 * kS);
  u.onConnected(now + 3 * kS);
  TEST_ASSERT_FALSE(u.next(now + 3 * kS, r));   // a 401 pause stays
}

static void test_long_log_line_stays_out() {
  Uplink u; ready(u);
  u.onConnected(0);
  u.onStat(std::string(511, 's'), 10 * kS);
  u.onPassing("2A", 1000, 10 * kS);
  Request r;
  TEST_ASSERT_TRUE(u.next(10 * kS, r));
  TEST_ASSERT_TRUE(has(r.body, "{\"transponder\":\"2A\",\"t\":1000}"));
  TEST_ASSERT_FALSE(has(r.body, "\"logs\""));
  u.answer(200, "{\"stored\":1,\"duplicates\":0,\"through\":1000}", 10 * kS);
  u.onStat(std::string(510, 's'), 20 * kS);
  TEST_ASSERT_TRUE(u.next(20 * kS, r));
  TEST_ASSERT_TRUE(has(r.body, std::string(510, 's')));
}

static void test_heartbeat_only_while_in_use() {
  Uplink u; ready(u);
  Request r;
  u.onStat("stat up=1", 5 * kS);
  TEST_ASSERT_FALSE(u.next(5 * kS, r));   // never connected: not in use
  u.onConnected(0);
  u.onStat("stat up=10", 10 * kS);
  TEST_ASSERT_TRUE(u.next(10 * kS, r));
  TEST_ASSERT_TRUE(has(r.body, "\"passings\":[]"));
  TEST_ASSERT_TRUE(has(r.body, "\"logs\":[\"stat up=10\"]"));
  TEST_ASSERT_TRUE(has(r.body, "\"now\":10000"));
  TEST_ASSERT_FALSE(has(r.body, "\"quiet\""));
  u.answer(200, "{\"stored\":0,\"duplicates\":0,\"through\":null}", 10 * kS);
  TEST_ASSERT_FALSE(u.next(11 * kS, r));
  const int64_t end = Uplink::kInUseUs;
  u.onStat("stat up=910", end + 10 * kS);
  TEST_ASSERT_TRUE(u.next(end + 10 * kS, r));
  TEST_ASSERT_TRUE(has(r.body, "\"quiet\":true"));
  TEST_ASSERT_TRUE(has(r.body, "\"logs\":[\"stat up=910\"]"));
  u.answer(200, "{\"stored\":0,\"duplicates\":0,\"through\":null}", end + 10 * kS);
  u.onStat("stat up=920", end + 20 * kS);
  TEST_ASSERT_FALSE(u.next(end + 20 * kS, r));
  u.onPassing("2A", 925000, end + 25 * kS);
  TEST_ASSERT_TRUE(u.next(end + 25 * kS, r));
  TEST_ASSERT_TRUE(has(r.body, "\"t\":925000"));
  TEST_ASSERT_FALSE(has(r.body, "\"quiet\""));
  u.answer(200, "{\"stored\":1,\"duplicates\":0,\"through\":925000}", end + 25 * kS);
  u.onStat("stat up=930", end + 30 * kS);
  TEST_ASSERT_TRUE(u.next(end + 30 * kS, r));
  TEST_ASSERT_TRUE(has(r.body, "\"passings\":[]"));
  TEST_ASSERT_FALSE(has(r.body, "\"quiet\""));
}

static void test_boot_line_goes_with_the_next_batch() {
  Uplink u; ready(u);
  u.onBootLine("boot fw=v1 reset=poweron");
  u.onPassing("2A", 1000, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  TEST_ASSERT_TRUE(has(r.body, "\"logs\":[\"boot fw=v1 reset=poweron\"]"));
  u.answer(200, "{\"stored\":1,\"duplicates\":0,\"through\":1000}", 0);
  u.onPassing("2A", 2000, 0);
  TEST_ASSERT_TRUE(u.next(0, r));
  TEST_ASSERT_FALSE(has(r.body, "\"logs\""));
}

static void test_a_new_decoder_id_leaves_the_old_backlog_behind() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  u.onPassing("2B", 2000, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));   // both are in flight for d1
  u.configure({"https://x", "d2", kToken2});
  TEST_ASSERT_EQUAL(0, u.waiting());
  u.onPassing("2C", 500, 0);
  u.answer(200, "{\"stored\":2,\"duplicates\":0,\"through\":2000}", 0);   // d1's answer arrives
  TEST_ASSERT_EQUAL(1, u.waiting());
  TEST_ASSERT_TRUE(u.next(0, r));
  TEST_ASSERT_TRUE(has(r.url, "/decoders/d2/passings"));
  TEST_ASSERT_TRUE(has(r.body, "\"transponder\":\"2C\""));
  TEST_ASSERT_FALSE(has(r.body, "\"transponder\":\"2A\""));
}

static void test_a_401_for_an_old_token_does_not_pause_the_new_one() {
  Uplink u; ready(u);
  u.onPassing("2A", 1000, 0);
  Request r;
  TEST_ASSERT_TRUE(u.next(0, r));
  u.configure({"https://x", "d1", kToken2});
  u.answer(401, "", 0);
  TEST_ASSERT_FALSE(u.paused());
  TEST_ASSERT_TRUE(u.next(0, r));
  TEST_ASSERT_EQUAL_STRING(("Bearer " + kToken2).c_str(), r.auth.c_str());
}

static void test_nothing_without_server_or_pairing() {
  Request r;
  Uplink a;
  a.configure({"", "d1", kToken});
  a.onBoot("b00tb00t", 0);
  a.onPassing("2A", 1000, 0);
  TEST_ASSERT_FALSE(a.next(0, r));
  TEST_ASSERT_EQUAL(1, a.waiting());
  Uplink b;
  b.configure({"https://x", "", ""});
  b.onBoot("b00tb00t", 0);
  b.onConnected(0);
  b.onPassing("2A", 1000, 0);
  b.onStat("stat up=10", 10 * kS);
  TEST_ASSERT_FALSE(b.next(10 * kS, r));
  b.configure({"https://x", "d1", kToken});
  TEST_ASSERT_TRUE(b.next(10 * kS, r));
}

static void test_batch_body_escapes_log_lines() {
  int64_t now = 42;
  std::string body = batchBody("b00tb00t", {{"2A", 1}, {"FF", 2}}, {"a\"b\\c"}, &now, true);
  TEST_ASSERT_EQUAL_STRING(
      "{\"boot\":\"b00tb00t\",\"passings\":[{\"transponder\":\"2A\",\"t\":1},{\"transponder\":\"FF\",\"t\":2}],"
      "\"logs\":[\"a\\\"b\\\\c\"],\"now\":42,\"quiet\":true}",
      body.c_str());
  TEST_ASSERT_EQUAL_STRING("{\"boot\":\"b00tb00t\",\"passings\":[]}", batchBody("b00tb00t", {}, {}, nullptr, false).c_str());
}

static void test_read_through_null_and_number() {
  int64_t t = -1;
  TEST_ASSERT_TRUE(readThrough("{\"stored\":1,\"duplicates\":0,\"through\":81234}", t));
  TEST_ASSERT_EQUAL(81234, t);
  TEST_ASSERT_TRUE(readThrough("{ \"through\" : 7 }", t));
  TEST_ASSERT_EQUAL(7, t);
  TEST_ASSERT_TRUE(readThrough("{\n\t\"through\":\r\n 7\n}", t));
  TEST_ASSERT_EQUAL(7, t);
  TEST_ASSERT_FALSE(readThrough("{\"stored\":0,\"duplicates\":0,\"through\":null}", t));
  TEST_ASSERT_FALSE(readThrough("{\"stored\":0}", t));
  TEST_ASSERT_FALSE(readThrough("", t));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_passing_goes_out_at_once);
  RUN_TEST(test_trailing_slash_on_server);
  RUN_TEST(test_one_request_in_flight);
  RUN_TEST(test_answer_drops_only_what_the_batch_carried_and_through_covers);
  RUN_TEST(test_older_boot_goes_first_without_now);
  RUN_TEST(test_fifth_boot_drops_the_oldest);
  RUN_TEST(test_full_outbox_drops_the_oldest);
  RUN_TEST(test_batch_holds_at_most_500);
  RUN_TEST(test_401_pauses_until_configure_gives_a_new_token);
  RUN_TEST(test_a_new_decoder_id_leaves_the_old_backlog_behind);
  RUN_TEST(test_a_401_for_an_old_token_does_not_pause_the_new_one);
  RUN_TEST(test_404_and_422_drop_the_batch);
  RUN_TEST(test_429_waits_retry_after);
  RUN_TEST(test_backoff_doubles_to_30_s_and_resets_on_200);
  RUN_TEST(test_429_retry_after_is_at_most_an_hour);
  RUN_TEST(test_200_without_through_backs_off);
  RUN_TEST(test_reconnecting_ends_the_backoff);
  RUN_TEST(test_long_log_line_stays_out);
  RUN_TEST(test_heartbeat_only_while_in_use);
  RUN_TEST(test_boot_line_goes_with_the_next_batch);
  RUN_TEST(test_nothing_without_server_or_pairing);
  RUN_TEST(test_batch_body_escapes_log_lines);
  RUN_TEST(test_read_through_null_and_number);
  return UNITY_END();
}
