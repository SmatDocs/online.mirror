# Agent instructions

This rule is mirrored from the SmartDocs workspace `AGENTS.md` (one level above this
repository). Keep the copies identical; when the rule changes, update the workspace
file and every repository copy (backend, frontend, PPB-Demo, online_update).

## Production impact first

Applies to every agent and every change that adds or reshapes a feature, a
background loop or worker, a queue, a stored document or table, a poll, a retry,
a dependency, or anything else on the request path. Build only what is needed,
never just because it is possible.

### Explain before building, and wait for the owner's go-ahead

Write a short impact note, local Markdown or in the chat, answering:

1. **Need.** The problem, who has it, why now, and what happens if we don't
   build it. Name the simpler alternative and why it is not enough.
2. **Latency on the user path.**
   - The time added per message or request, and the effect on time to first
     token.
   - The number of *sequential* network round trips, and where each one goes.
     From Europe, Firestore `nam5` (US) costs ~150–450 ms per round trip;
     Postgres, KeyDB and Milvus on the private network cost milliseconds.
   - Anything that blocks the event loop or holds Python's GIL beside chat.
3. **Complexity and growth.** The work per request and per background tick, as a
   function of users, chats, cameras, documents, events and history. Anything
   that rescans "everything ever" on a timer is not acceptable; query only the
   open or due items.
4. **Recurring cost, with a monthly $ estimate.**
   - Reads and writes per minute, and the bytes each operation moves (the
     document size, not just the count).
   - Egress: Firestore to Finland or Contabo is internet egress at
     ~$0.118/GiB, and 1 MB/min sustained ≈ $4.75/month.
   - LLM calls and tokens, and CPU, RAM and disk on the host it runs on.
5. **Where it runs.**
   - Finland serves users. Owner exception, 2026-10-31: the existing sales-agent
     background worker may also run on Finland, separate from the API process.
   - Other background, heavy or periodic work runs on the worker host (Contabo),
     or Acuon for experiments, never inside the API process beside chat.
   - Work that runs per replica must be leased so it runs once.
6. **Failure behaviour.**
   - Retries must back off and stop; a permanent error must not retry
     forever.
   - What happens on deploy, restart and failover.
   - Old or finished items must be retired, not re-queued.
7. **Data placement and replication.**
   - Keep hot-path data near compute.
   - No large blobs in documents that are read often: store big data once,
     reference it by id or hash, and keep the hot document small.
   - Postgres replication publishes an explicit list of tables between two
     writers, so a new table needs the replication step on both nodes and
     natural or UUID keys (no sequences).
8. **How we will measure it in production.** Name the log line, metric or
   probe, and record before/after numbers once it is deployed.

Then build, deploy through the pipeline, measure, and report the numbers
against the note.

### Lessons this rule comes from (October 2026)

- **Agent inbox on Firestore in the US:** about 12 sequential round trips per
  message, adding 3.7 s median (7.2 s p90) before every agent turn. On Postgres
  it takes about 20 ms. See the workspace report `reports/ai-systems/agent-turn-overhead-2026-10-16.md`.
- **Video recovery scan:** re-read every camera run ever, every 30 s, in every
  replica. A movement-map bug then retried failed monitors every 2 minutes,
  forever (600–2,000 times per run).
- **Run documents of 215 KB:** 95% was a movement map stored twice, re-read by
  every transaction. That was about 93 MB/min (~$440/month) for one camera.
- **Video loops inside the chat process:** held the GIL 50% of the time and
  quadrupled Luna latency. See
  the workspace report `reports/infrastructure/servers/firestore-and-latency-fixes-2026-10-16.md`.

# User tests

Whenever you finish work that the owner (or another user) should try for
themselves, such as a new feature, a fix they reported, a changed answer, a new
camera or a deploy that changes what people see, do two things:

1. **Test it yourself first**, on the real deployed path where you can, and
   record what you ran and what you saw. Don't hand over something you haven't
   tried. For agent-backed apps, verify actual startup, authentication and a real
   agent reply through the intended path. A build, healthy port or mocked test
   alone is not proof; distinguish fixtures from real runtime results.
2. **Write a user test** as a Markdown file in
   `user-tests/<topic>/<short-name>-YYYY-MM-DD.md` (for example
   `user-tests/video-intelligence/question-box-last-person-2026-11-01.md`).
   Create the folder if it doesn't exist. One file per thing to test.

Each user test says, in plain words:

- **What changed:** "I have done X", in one or two sentences.
- **Where:** the page, app, chat or channel, and which account, camera or
  document to use.
- **Steps:** numbered, each one a single action. Give the exact prompt or
  question to type in a code block, so it can be copied.
- **What you should see:** the expected result for each step, including how
  fast it should be.
- **What would be wrong:** the failure signs to look out for.
- **My own test:** when you ran it, what you typed, and what you got (with
  times and screenshot paths if you have them).
- **Status:** use `in progress` or `blocked` for missing prerequisites, and
  `failed` for a reproduced defect; name the blocker and what was not run. Use
  `ready to test` only after your own real-path check passes. The owner records
  `passed` or `failed` with a note; update the same file after a fix.

Keep `user-tests/README.md` as the index, newest first, one line per test with
its status. Mention the file path in your final reply. Never put credentials,
tokens or private stream URLs in a user test.

# Backend runtime readiness

Applies to backend Python APIs, WebSockets and worker services. Prepare enabled
user-facing SDKs, clients, tool registries, static graphs and prompt assets before
reporting ready. Do not shift their import, schema or credential setup onto the
first request, or silently repair failed startup from a request getter. Construct
loop-owned clients on their serving loop and reuse bounded caches with the same
provider, key, model, timeout, dimensions and configuration used by real calls.
Necessary runtime reconnects/auth refresh and request-specific work remain bounded.

Prepare heavy dependencies in their existing worker process, preserving isolation
and process limits. Keep disabled/unconfigured capabilities explicit. Warmup must
not invoke paid models, create provider caches, or read customer data. Do not use
recurring paid warmup calls to compensate for client recreation. Test readiness
failures, actual first/repeat requests, and late SDK imports/constructor misses.
If an existing isolation/memory policy prevents preparation, document the measured
tradeoff for an owner decision; do not claim that path is fixed.

# OpenAI prompt changes and response continuation

Owner decision, 2026-11-01: while developing an agent or changing its system
prompt, use `use_previous_response_id=False` for the affected agent. Leave
unrelated agents unchanged unless the task authorizes a wider policy change.

- Check the final SDK request, not only the prompt file or Langfuse's pre-SDK
  input. It must contain the current system/developer instructions, trusted
  channel context and the intended backend history or compaction summary.
- Test an existing conversation containing real reasoning and tool messages.
  A fresh-chat or direct-model test can miss transformations in the real caller.
  Confirm the primary provider succeeds; a fallback reply alone is not proof.
- Production may enable response-ID continuation after development is complete
  and real-path tests prove current instructions are resent on every request.
  A stable prompt file alone is not enough. Recheck prompt updates, handoffs,
  channel changes and compaction before enabling it; otherwise keep it off.
- Preserve provider-valid reasoning/message/tool pairs through normalization.
  Do not fix replay errors by deleting customer chats or silently relying on a
  fallback. A reset needs the owner's explicit authorization.
- Prepare clients at startup with the same continuation setting used by real
  calls. Do not create a different SDK client on the first request.
- Prompt caching is separate from response continuation. Measure actual cached
  input, primary/fallback route, errors, first-token time and total time; do not
  assume an ID guarantees cache savings or makes retained history free.
