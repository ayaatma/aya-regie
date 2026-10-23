---
name: feedback-test-hang-on-failed-assert
description: "A failing assert.ok WITHOUT a message can freeze `node --test` under tsx here (seen 2026-10-23): a whole suite then looks endless. Run long suites per file with `timeout`, never piped through grep alone."
metadata:
  type: feedback
---

On 2026-10-23 `npm test` ran over 15 minutes with no output: one `ok(...)` with no message was
failing (an expected French wording had been renamed), and Node, building the error message from
the source, froze instead of reporting. The developer noticed (« Ils durent longtemps les tests
non ? »).

**Why:** piping `npm test | grep "^# pass"` hides everything until the end, so a frozen failure
is indistinguishable from a slow suite.

**How to apply:** when tests take longer than usual (engine about 2 min, app about 2 min, the
screens file the longest), run each test file with `timeout` and a tap reporter to a file, then
bisect with `--test-name-pattern`. Give new `ok(...)` assertions a message. After renaming any
user-visible text, grep the tests for the old wording first.
