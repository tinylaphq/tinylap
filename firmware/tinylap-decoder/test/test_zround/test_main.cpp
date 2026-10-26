#include <unity.h>
#include <ArduinoJson.h>
#include <fstream>
#include <sstream>
#include <string>
#include "zround.h"

using namespace tinylap;

static JsonDocument vectors;

void setUp() {}
void tearDown() {}

static const char* typeName(Message::Type t) {
  switch (t) {
    case Message::Type::Startup: return "startup";
    case Message::Type::Reset: return "reset";
    case Message::Type::Stop: return "stop";
    case Message::Type::HelloRequest: return "hello-request";
    case Message::Type::Pair: return "pair";
    case Message::Type::Wifi: return "wifi";
    default: return "unknown";
  }
}

// Compares a message with a vector's expected one: the type, and the fields for pair and wifi.
static void expectMessage(const Message& m, JsonVariantConst want, const std::string& what) {
  TEST_ASSERT_EQUAL_STRING_MESSAGE(want["type"].as<const char*>(), typeName(m.type), what.c_str());
  std::string type = want["type"].as<std::string>();
  if (type == "pair") {
    TEST_ASSERT_EQUAL_STRING_MESSAGE(want["decoder"].as<const char*>(), m.decoder.c_str(), what.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(want["token"].as<const char*>(), m.token.c_str(), what.c_str());
  } else if (type == "wifi") {
    TEST_ASSERT_EQUAL_STRING_MESSAGE(want["ssid"].as<const char*>(), m.ssid.c_str(), what.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(want["password"].as<const char*>(), m.password.c_str(), what.c_str());
  }
}

void test_to_decoder() {
  for (JsonObjectConst v : vectors["toDecoder"].as<JsonArrayConst>()) {
    std::string body = v["body"].as<std::string>();
    expectMessage(parseMessage(body), v["message"], body);
  }
}

void test_from_decoder() {
  for (JsonObjectConst v : vectors["fromDecoder"].as<JsonArrayConst>()) {
    JsonVariantConst call = v["call"];
    JsonArrayConst args = call.is<JsonArrayConst>() ? call.as<JsonArrayConst>() : JsonArrayConst();
    std::string name = args.isNull() ? call.as<std::string>() : args[0].as<std::string>();
    std::string got;
    if (name == "ack") got = line::ack();
    else if (name == "ok") got = line::ok();
    else if (name == "error") got = line::error(args[1].as<std::string>());
    else if (name == "id") got = line::id(args[1].isNull() ? std::string() : args[1].as<std::string>(), args[2].as<std::string>());
    else if (name == "lap") got = line::lap(args[1].as<std::string>(), args[2].as<uint64_t>());
    else if (name == "clock") got = line::clock(args[1].as<uint64_t>());
    else if (name == "transponder") got = line::transponder(args[1].as<uint8_t>());
    else TEST_FAIL_MESSAGE(name.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(v["line"].as<const char*>(), got.c_str(), name.c_str());
  }
}

void test_streams() {
  for (JsonObjectConst s : vectors["streams"].as<JsonArrayConst>()) {
    Reader reader;
    std::vector<Message> got;
    for (JsonVariantConst chunk : s["chunks"].as<JsonArrayConst>()) {
      std::string c = chunk.as<std::string>();
      for (const Message& m : reader.push(c.data(), c.size())) got.push_back(m);
    }
    JsonArrayConst want = s["messages"];
    TEST_ASSERT_EQUAL_size_t(want.size(), got.size());
    for (size_t i = 0; i < got.size(); i++) expectMessage(got[i], want[i], "stream");
  }
}

void test_reader_bounded() {
  Reader reader;
  std::string noise(5000, 'x');
  TEST_ASSERT_EQUAL_size_t(0, reader.push(noise.data(), noise.size()).size());
  std::vector<Message> got = reader.push("%C&", 3);
  TEST_ASSERT_EQUAL_size_t(1, got.size());
  TEST_ASSERT_TRUE(got[0].type == Message::Type::Startup);
}

void test_valid_ids() {
  TEST_ASSERT_TRUE(validDecoderId("dec_1"));
  TEST_ASSERT_TRUE(validDecoderId(std::string(64, 'a')));
  TEST_ASSERT_FALSE(validDecoderId(std::string(65, 'a')));
  TEST_ASSERT_FALSE(validDecoderId(""));
  TEST_ASSERT_FALSE(validDecoderId("a b"));
  TEST_ASSERT_TRUE(validToken(std::string(43, 'a')));
  TEST_ASSERT_FALSE(validToken(std::string(42, 'a')));
}

// Runs first: the tests after it read the vectors it loads.
void test_vectors_load() {
  std::ifstream file(VECTORS_PATH);
  TEST_ASSERT_TRUE_MESSAGE(file.is_open(), "cannot open " VECTORS_PATH);
  std::stringstream text;
  text << file.rdbuf();
  DeserializationError err = deserializeJson(vectors, text.str());
  TEST_ASSERT_FALSE_MESSAGE(err, err.c_str());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_vectors_load);
  RUN_TEST(test_to_decoder);
  RUN_TEST(test_from_decoder);
  RUN_TEST(test_streams);
  RUN_TEST(test_reader_bounded);
  RUN_TEST(test_valid_ids);
  return UNITY_END();
}
