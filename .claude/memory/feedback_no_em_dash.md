---
name: feedback-no-em-dash
description: "Never use the em dash character in anything a user could see (UI strings, docs, exports, website, code comments). Rephrase instead of substituting a hyphen."
metadata:
  type: feedback
---

Never use the em dash character (U+2014) in any text a user could see. That means UI strings,
documentation, exported plannings, the website, code comments, commit messages, basically
anything that is not a throwaway terminal reply.

**Why:** the user simply does not like it and would never type it themselves, so it reads as not
being their own writing. This is a style rule about their voice, not a technical constraint,
which means "it renders fine" is never a reason to keep one. The rule was given on the CrossFlow
project on 2026-08-29 and carried here as a general rule at the user's request.

**How to apply:** do NOT swap it for a hyphen and move on. A hyphen in an em dash's place is the
same sentence with a different character, and it was explicitly rejected. Restructure the
sentence instead. The usual moves:

- Split it into two sentences. Usually the best option, and usually shorter.
- Use a colon when what follows explains or expands what came before.
- Use a semicolon to join two closely related independent clauses.
- Use parentheses, or a pair of commas, for a genuine aside.
- Reorder so the clause needs no punctuation break at all.

Before finishing any user-visible file, grep it for the character and rewrite every hit. Watch
for it in generated output too (exported PDFs, CSV exports, anything copied into the WordPress
site).
