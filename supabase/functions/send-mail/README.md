# send-mail

Sends one validation mail (« ton inscription est validée ») through the association's mailbox, and
records it in the table `mail_log`. Why and how: `core.ts` (the pure part, tested in
`tools/src/send-mail.test.ts`) and `index.ts` (HTTP, the régisseur's session check, SMTP).

The message itself is written in the browser from the event's templates (Réglages > Mails de
validation); this function never reads the plan.

## One-time setup

1. **Database**: the table `mail_log` and the new columns come with the migration
   `db/migrations/2026-10-22_registration_validation.sql` (`npm run migrate -- --apply` in `tools/`).
2. **Secrets**, in Supabase (Edge Functions > Secrets, or `npx supabase secrets set NAME=value`):

   | Name             | Value                                                                 |
   |------------------|-----------------------------------------------------------------------|
   | `SMTP_HOST`      | the mail server, `ssl0.ovh.net` for an OVH mailbox                    |
   | `SMTP_USER`      | the mailbox's full address                                            |
   | `SMTP_PASSWORD`  | its password                                                          |
   | `SMTP_PORT`      | optional, `465` by default (Supabase refuses outgoing 25 and 587)     |
   | `SMTP_FROM`      | optional, the sender address, the mailbox by default (OVH insists)    |
   | `SMTP_FROM_NAME` | optional, the name shown as sender, e.g. the association's            |
   | `SMTP_REPLY_TO`  | optional, where answers go when not to the mailbox                    |

   The same mailbox as the login links (Authentication > SMTP Settings) works. Nothing of this goes
   in the repository.
3. **Deploy**, from the repository root:

   ```
   npx supabase functions deploy send-mail --project-ref <project-ref>
   ```

Until this is done, validating somebody still works; the mail is recorded as failed with the
reason, and « Renvoyer le mail » on the fiche tries again.
