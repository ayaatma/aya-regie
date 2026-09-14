---
name: feedback-dont-reinterpret-reported-symptom
description: "When the user names a specific thing as a symptom and a search for it comes up empty, do not silently substitute the nearest thing found in the same area and present it as the fix."
metadata:
  type: feedback
---

When the user names a specific noun for a symptom (a marker, a label, a warning, a specific
dialog, a specific column), and a code search for that literal thing comes up empty, do not
substitute a different concept that happens to live in the same general area and ship it as the
fix.

**Why:** On CrossFlow (2026-08-01) a reported "marker on transcoded files" was searched for in
code, found nothing, and got silently reinterpreted as leftover sequence In/Out points. The real
cause was a genuine marker baked in by an export preset setting, a mechanism outside any
scripted call. "No code creates this" was true, and was wrong evidence: it meant the thing came
from somewhere other than our own code, not that the user meant something else.

**How to apply:** (a) consider that the reported thing may come from a platform, a library, a
config file, a form export or a spreadsheet setting rather than from code this project writes,
and look there too; (b) if still uncertain, say so explicitly so the user can correct the aim
before code gets written. This user is happy to answer a narrow follow-up question, and that
costs far less than a confident wrong fix.

Related: [[feedback-verify-root-cause-before-fixing]].
