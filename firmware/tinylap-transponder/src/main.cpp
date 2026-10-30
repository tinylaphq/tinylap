// The transponder: TinyLap IR frames in a loop with random gaps, from an ATtiny45. Glue only (spec §4.2, §4.3).
#include <avr/eeprom.h>
#include <avr/interrupt.h>
#include <avr/io.h>
#include <avr/power.h>
#include <avr/sleep.h>
#include <avr/wdt.h>
#include <util/delay.h>
#include "tinylap_ir.h"
#include "transponder.h"

namespace {

// EEPROM layout (spec §4.4): the id, its complement, and an OSCCAL value or 0xFF for the factory one.
uint8_t* const kEeId = (uint8_t*)0;
uint8_t* const kEeIdComplement = (uint8_t*)1;
uint8_t* const kEeOsccal = (uint8_t*)2;
constexpr uint8_t kLedBit = _BV(TL_LED_PIN);
// The watchdog's prescaler for the blink: 256K cycles of its 128 kHz oscillator, 2 s (datasheet table 8-3).
constexpr uint8_t kWdt2s = _BV(WDP2) | _BV(WDP1) | _BV(WDP0);
static_assert(TL_BLINK_PERIOD_MS == 2000, "kWdt2s sets the blink's period");

uint16_t levels[TL_LEVELS];

// Sends `cycles` carrier cycles (at least 1) on the LED pin, or holds it low as long when !on. Every cycle is
// 210 clocks, 105 high and 105 low, in both cases: the two cases differ only in the value the first `out`
// writes. Call with interrupts off.
//
// Clocks per instruction (AVR instruction set manual, ATtiny45):
//   high half: out 1, ldi 1, dec/brne 34 x 3 - 1 = 101, rjmp .+0 2              = 105
//   low half:  out 1, ldi 1, dec/brne 33 x 3 - 1 = 98, nop 1, sbiw 2, brne 2     = 105
// The last cycle's brne falls through in 1, so it ends after 209 clocks, plus 4 for ret. The pin then stays
// low until the next level's first `out`.
//
// Between two calls (checked in avr-objdump of this build): the last brne 1, ret 4, the main loop's counter,
// level load and rcall 17, and carrier's prologue up to the first `out` 6 (cpse skips the ori in 2 or runs
// with it in 2, so on and !on match). A level of n cycles therefore lasts n x 210 + 26 clocks, and the time
// between two burst starts 52 clocks (6.5 us) more than its cycles say; the clock check on the 2000 us start
// period (spec §4.4) calibrates that in with the rest.
__attribute__((noinline)) void carrier(uint16_t cycles, bool on) {
  uint8_t lo = PORTB & (uint8_t)~kLedBit;
  uint8_t hi = on ? (uint8_t)(lo | kLedBit) : lo;
  uint8_t delay;
  asm volatile(
      "1:  out  %[port], %[hi]   \n\t"  // 1
      "    ldi  %[d], 34         \n\t"  // 1
      "2:  dec  %[d]             \n\t"  // 1
      "    brne 2b               \n\t"  // 2, 1 the last time
      "    rjmp .+0              \n\t"  // 2
      "    out  %[port], %[lo]   \n\t"  // 1
      "    ldi  %[d], 33         \n\t"  // 1
      "3:  dec  %[d]             \n\t"  // 1
      "    brne 3b               \n\t"  // 2, 1 the last time
      "    nop                   \n\t"  // 1
      "    sbiw %[n], 1          \n\t"  // 2
      "    brne 1b               \n\t"  // 2, 1 the last time
      : [n] "+w"(cycles), [d] "=&d"(delay)
      : [port] "I"(_SFR_IO_ADDR(PORTB)), [hi] "r"(hi), [lo] "r"(lo));
}

void applyOsccal() {
  uint8_t target = eeprom_read_byte(kEeOsccal);
  if (target == 0xFF) return;
  // One unit at a time: the datasheet warns against large jumps of the running clock. The flashing script keeps
  // the target in the factory value's range (OSCCAL bit 7), so no step crosses between the two ranges.
  while (OSCCAL != target) OSCCAL = OSCCAL < target ? OSCCAL + 1 : OSCCAL - 1;
}

// Without a valid id: no frames, but the pattern of tlBlinkStepMs once per watchdog period, powered down in
// between. The LED is plainly on, without the 38 kHz carrier, so the receivers' output stays idle and the decoder
// counts nothing, while a phone camera shows it. Through R1 (33 ohm) the LED draws about 100-115 mA, briefly at or
// just above its continuous I_F; fine at 7.5% duty.
[[noreturn]] void blinkWithoutId() {
  WDTCR = _BV(WDCE) | _BV(WDE);                           // timed sequence: the next write within 4 clocks
  WDTCR = _BV(WDIE) | kWdt2s;                             // an interrupt every TL_BLINK_PERIOD_MS, no reset
  set_sleep_mode(SLEEP_MODE_PWR_DOWN);
  for (;;) {
    for (uint8_t i = 0; i < TL_BLINK_STEPS; i++) {
      if (i % 2 == 0) PORTB |= kLedBit;
      else PORTB &= (uint8_t)~kLedBit;
      for (uint16_t n = tlBlinkStepMs(i); n; n--) _delay_ms(1);
    }
    PORTB &= (uint8_t)~kLedBit;
    sei();
    sleep_mode();  // until the watchdog's next interrupt
    cli();
  }
}

}  // namespace

EMPTY_INTERRUPT(WDT_vect);  // only wakes blinkWithoutId

int main() {
  // A watchdog reset leaves the watchdog on, which would reset again before the blink sets it up: off first.
  MCUSR &= (uint8_t)~_BV(WDRF);
  wdt_disable();
  clock_prescale_set(clock_div_1);  // 8 MHz whether CKDIV8 is set or not
  applyOsccal();

  DDRB |= kLedBit;
  PORTB &= (uint8_t)~kLedBit;

  uint8_t id = eeprom_read_byte(kEeId);
  if (!tlIdValid(id, eeprom_read_byte(kEeIdComplement))) blinkWithoutId();
  tlEncodeFrame(id, levels, TL_LEVELS);
  uint16_t state = tlSeed(id);

  for (;;) {
    cli();
    for (uint8_t i = 0; i < TL_LEVELS; i++) carrier(levels[i], (i & 1) == 0);  // even levels are bursts
    sei();
    for (uint16_t n = tlNextGapUs(state) / 100; n; n--) _delay_us(100);
  }
}
