-- Allow the "processing" claim state in sms_draft_log.decision.
--
-- ghl-sms-draft now writes its log row BEFORE doing any work (claim-before-work),
-- so the unique index sms_draft_log_dedupe (conversation_id, inbound_message_id)
-- actually blocks a concurrent cron run from drafting a second reply to the same
-- inbound message. The row is updated to its final decision (draft/skip/flag_human/
-- error) when the run finishes; rows left at "processing" mean a run died mid-flight.
--
-- Ports the fix already shipped in Discipline Rift (commit 5b603a0).

alter table public.sms_draft_log
  drop constraint if exists sms_draft_log_decision_check;

alter table public.sms_draft_log
  add constraint sms_draft_log_decision_check
  check (decision = any (array['draft', 'skip', 'flag_human', 'error', 'processing']));