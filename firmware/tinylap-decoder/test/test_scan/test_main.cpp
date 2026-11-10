#include <unity.h>
#include <string>
#include <vector>
#include "scan.h"
#include "zround.h"

using namespace tinylap;

void setUp() {}
void tearDown() {}

static void test_dedupes_names_keeping_the_strongest() {
  std::vector<std::string> lines = scanLines({{"Clubhaus", -80, false}, {"Clubhaus", -52, false}, {"Clubhaus", -66, true}});
  TEST_ASSERT_EQUAL(2, lines.size());
  TEST_ASSERT_EQUAL_STRING(line::ap("Clubhaus", -52, false).c_str(), lines[0].c_str());
  TEST_ASSERT_EQUAL_STRING(line::scanEnd(1).c_str(), lines[1].c_str());
}

static void test_sorted_strongest_first() {
  std::vector<std::string> lines = scanLines({{"B", -70, true}, {"A", -40, false}, {"C", -90, false}});
  TEST_ASSERT_EQUAL(4, lines.size());
  TEST_ASSERT_EQUAL_STRING(line::ap("A", -40, false).c_str(), lines[0].c_str());
  TEST_ASSERT_EQUAL_STRING(line::ap("B", -70, true).c_str(), lines[1].c_str());
  TEST_ASSERT_EQUAL_STRING(line::ap("C", -90, false).c_str(), lines[2].c_str());
  TEST_ASSERT_EQUAL_STRING(line::scanEnd(3).c_str(), lines[3].c_str());
}

static void test_hidden_names_left_out() {
  std::vector<std::string> lines = scanLines({{"", -30, false}, {"Clubhaus", -60, false}});
  TEST_ASSERT_EQUAL(2, lines.size());
  TEST_ASSERT_EQUAL_STRING(line::ap("Clubhaus", -60, false).c_str(), lines[0].c_str());
  TEST_ASSERT_EQUAL_STRING(line::scanEnd(1).c_str(), lines[1].c_str());
  TEST_ASSERT_EQUAL_STRING(line::scanEnd(0).c_str(), scanLines({{"", -30, true}})[0].c_str());
}

static void test_at_most_30_then_end() {
  std::vector<ApRecord> records;
  for (int i = 0; i < 40; i++) records.push_back({"net" + std::to_string(i), -30 - i, false});
  std::vector<std::string> lines = scanLines(records);
  TEST_ASSERT_EQUAL(31, lines.size());
  TEST_ASSERT_EQUAL_STRING(line::ap("net0", -30, false).c_str(), lines[0].c_str());
  TEST_ASSERT_EQUAL_STRING(line::ap("net29", -59, false).c_str(), lines[29].c_str());
  TEST_ASSERT_EQUAL_STRING(line::scanEnd(30).c_str(), lines[30].c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_dedupes_names_keeping_the_strongest);
  RUN_TEST(test_sorted_strongest_first);
  RUN_TEST(test_hidden_names_left_out);
  RUN_TEST(test_at_most_30_then_end);
  return UNITY_END();
}
