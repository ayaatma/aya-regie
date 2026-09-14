---
name: feature-auth
description: "The régisseur login, reworked 2026-09-09: password as the everyday door, magic link kept for the first connection and for a forgotten password, each person choosing their own password from « Mon compte »."
metadata:
  type: project
---

**State 2026-09-09: built, tested and verified against the live Supabase project.** The login has
two doors. The password is the everyday one, the link sent by email opens an account the first
time and reopens it when the password is gone. 196 app tests pass, 11 of them new.

## Why it changed

The magic link was the only door for a day, from 2026-09-08 to 2026-09-09. It was chosen for
good reasons that still hold, written up in [[feature-supabase]]: nothing to lose, nothing to
share around the association, and the mailbox already proves who somebody is. What it costs is a
trip to the mailbox on every machine that carries no session yet, and that is exactly the moment
somebody is in a hurry. The régisseur asked for a real login on 2026-09-09.

**The old decision said a password shared around an association ends up in a group chat, and it
was right.** The design here does not contradict it: nobody is ever handed a password. Each
régisseur chooses their own, from inside the tool, once the link has let them in. So no password
travels through a mail, a message or a shared document, the régisseur has nothing to distribute,
and this repository still needs no `service_role` key.

The alternative considered and rejected was creating the accounts with a password from a script
in `tools/`, through the admin API. Half the code, but it brings the `service_role` key into the
repository and it puts a password on a channel somebody has to choose. For three or four
régisseurs the saving was not worth either.

## Note before blaming the login

A Supabase session is already persisted in `localStorage` and refreshed on its own
(`persistSession`, `autoRefreshToken` in `persistence/supabaseClient.ts`). One magic link should
therefore hold for weeks on one browser. If a régisseur is asked to log in again and again on the
**same** machine, the password is not the fix and the cause is elsewhere: a session time box or
an inactivity timeout in Authentication > Sessions, or a browser clearing site data. The password
answers a different question, which is opening the tool on a machine that has no session at all.

## Where it lives

- `app/src/auth/errors.ts`: GoTrue's English answers translated, and the two password rules
  checked in the browser. Pure, no React, no network: it is the part of the login that can be
  tested at all, and it is where every failure from both doors and from the password change ends
  up. `MIN_PASSWORD` is 8, stricter than the project's own 6.
- `app/src/auth/AuthGate.tsx`: the gate, unchanged in principle, plus `LoginCard`, exported so a
  test can render it.
- `app/src/auth/AccountBar.tsx`: choosing a password, in the banner slot under the header.
- `app/src/auth/auth.test.tsx`: the translations, the two-field rule, and a server render of both
  cards.
- `App.tsx`: the « Mon compte » button, drawn only when there is a session, and the fifth tenant
  of the banner slot.

## The decisions

- **The password card renders without ever constructing a Supabase client.** `getSupabase()` is
  called inside the submit handlers only. That is what lets `LoginCard` and `AccountBar` be
  server rendered by the tests on a machine with no configuration, which matters because these
  are the one screen nobody meets while developing: a developer with a session never sees them.
- **`window.location` is read on demand, not at render.** Same reason. The redirect address is
  needed by a submit handler and by the panel that follows a submit, both of which only ever run
  in a browser.
- **Nothing happens on a successful password login.** No state is set, no redirect is written.
  The session lands in the client, the subscription in `useSession` fires, the gate swaps the
  card for the tool, and the component is gone before it could have set anything on itself.
- **"Adresse email ou mot de passe incorrect", never "unknown address".** GoTrue deliberately
  refuses to say which half was wrong, and so does the translation: naming the address would tell
  anybody who asks whether a given person is an organiser here.
- **An unknown GoTrue message is shown as it came**, prefixed rather than replaced. The ones that
  reach the fallback are rare, they name something real, and the person reading them is the one
  who can act on it or forward it.
- **Two password fields, compared in the browser.** A typo repeated identically in one field is
  the single mistake that locks somebody out of the account they have just set up, and the
  browser is the only place that ever sees both.
- **A hidden, read-only `autocomplete="username"` field in the account bar.** Without it a
  browser offers to save a password with no account attached, then fails to offer it back on the
  login form, which quietly turns the whole feature into a worse magic link.
- **The account bar sits in the banner slot, like the checkpoint bar**, rather than taking the
  screen: taking the screen means leaving the plan, and nobody wants that in the middle of an
  afternoon of assignments. The two never compete, opening either closes the other, because each
  is a form somebody is part-way through.
- **`submit` in the account bar wraps `getSupabase()` in a `try`.** It throws synchronously with
  no configuration, and a throw inside a submit handler is caught by no error boundary. Wrapped,
  it becomes the same sentence in the same place as every other failure.

## What was verified, and how

- 11 new tests, and the whole app suite at 196.
- The card was driven in a real browser against the live Supabase project on 2026-09-09: both
  doors toggle, and a deliberately wrong credential came back as **"Adresse email ou mot de passe
  incorrect."** That round trip proves two things beyond the translation: the email plus password
  provider is enabled on the project (a disabled one answers "Email logins are disabled"), and
  sign-ups being off does not block a password login for an account that already exists.
- Not verified end to end: setting a password from « Mon compte », which needs a real session.
  The bar renders and the failure paths are covered, but the first real password change is the
  régisseur's.

## What a régisseur does, once

Log in through the link as before, click **Mon compte** at the top right, choose a password
twice. Every login after that is email plus password, on any machine. Nothing to do in the
Supabase dashboard, no migration, no deploy setting: the whole change is in the bundle.

Sits with [[feature-supabase]], which holds the project settings, the SMTP relay and the Site URL
trap, and with [[feature-admin-ui]], which holds the banner slot this borrows.
