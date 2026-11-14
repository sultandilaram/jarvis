# Intelligence, autonomy and extensions

JARVIS keeps task reasoning separate from its voice connection. The default task
provider remains your signed-in Codex installation. Changing task providers does
not change the GPT voice provider or eliminate voice API usage.

## Intelligence

Settings → Intelligence supports Codex, OpenAI-compatible Chat Completions
servers, Ollama, Anthropic Messages and Gemini GenerateContent. Configure an exact
endpoint and model. API keys stay in the local encrypted vault and never appear
in status snapshots. HTTP is supported only for loopback servers; remote servers
require HTTPS. Redirects are refused.

Saving a profile does not contact its server. Test tools sends a harmless nonce
through one structured tool call and a result continuation. Until that succeeds,
the model can converse but cannot execute tasks. Test vision sends only a generated
eight-digit image. A successful vision test enables window images; it does not
establish reliable real-world computer use. Changing a saved profile clears both
checks. Custom servers must implement the selected protocol, not just text chat.

Selecting a different task provider shows its exact destination for confirmation.
Task text and requested file/account/tool results may then be sent to that server.
Window captures can also reach a vision-enabled provider. Provider charges and
retention policies apply separately. Local chat/task text can persist unencrypted;
inline window image payloads are removed from JARVIS's local history and consumed
adapter context. This does not control a provider's own retention.

## Autonomy

Settings → Autonomy defaults to review every action. Autopilot permits only these
trusted routine classifications: known ordinary app launches, exact public HTTPS
addresses in explicit opening requests, new non-executable text drafts
inside the app Workspace, isolated project imports/offline commands, and scrolling
to observed controls in known apps. Existing grants and OS confinement still apply.
Model-generated URLs, including addresses with data encoded in their host or path,
never inherit navigation authority. Cited URLs, quoted instructions, conditional or
negated requests and complex goals keep exact review. Each correction revokes
previous automatic destinations; only a successfully accepted explicit opening
request supplies replacements. Failed steering grants none. Recovery checkpoints
are not authorization.

Opening documents in external apps, sending messages, form submission, arbitrary clicking or typing, overwriting or
moving/deleting host files, account/security changes, networked commands, custom
plugin calls and source/release operations still pause for exact review. A model
cannot set its own risk classification. Stop cancels queued approval/dispatch and
invalidates observed desktop targets; it cannot undo completed side effects.

## macOS applications

JARVIS can inspect accessible app windows and propose text replacement, exposed
control actions and bounded clicks. Apps with incomplete accessibility trees can
use a captured-window visual click when the selected provider supports vision and
macOS Screen Recording is granted. The approval shows the captured window and
marked point. Input is bound to that image, window, frame and context; changed,
covered, sensitive or ambiguous targets are refused. Every visual click requires
approval, including in Autopilot. A dispatched click is not proof of success.
JARVIS must inspect its actual effect and must not automatically replay uncertainty.

Compatibility depends on each app and OS permissions. This is not a promise that
every app Codex can operate will work. Credential/payment controls, security
settings, terminals and JARVIS/Codex themselves are protected. Unsupported steps
must be reported rather than routed through an alternate unrestricted executor.
For a WhatsApp request, verify the conversation and exact message before sending.
No built-in WhatsApp account connector or unattended sending permission is added.

## Skills and plugins

Settings → Skills creates, imports and edits scoped Markdown/text procedures.
Imported instructions begin disabled for review. Skills are local plaintext
instructions, not permission grants, scripts or additional executors. No downloaded
skill assets execute. Keep credentials out of skills.

Settings → Plugins separates three types. The embedded Browser is always enabled.
Built-in Gmail and Google Calendar can be connected and enabled independently;
disabling one retains its saved account but blocks new requests. Google consent
opens in the system browser. Each installation needs its own configured Desktop
OAuth client and any required Google testing/verification setup; account access
is not bundled with the app. Sending mail and changing events remain reviewed.

External plugins configure custom MCP Streamable HTTP servers, with optional
Bearer authentication. Tokens are encrypted locally. Enabling a server requires
confirmation of its exact endpoint and access. Only the tools capability is
supported: no stdio processes, automatic installs, OAuth, sampling or elicitation.
Every tool call shows the exact server, tool and JSON arguments for approval;
read-only annotations do not bypass review. Catalog changes invalidate prepared
calls. Isolated project jobs cannot use these custom servers. A failed call is
never retried automatically because its external effects may be uncertain.

## JARVIS Browser

The Browser tab beside Voice and Chats contains up to 16 page tabs, with an
address/search bar, back/forward, reload/stop and close controls. Tabs share a
persistent JARVIS-only login session, separate from Arc and other browsers.
Open tabs are not restored after restarting JARVIS. Downloads, new-window popups
and website device permissions are blocked; a blocked HTTP(S) popup can be opened
explicitly in a new tab by the owner.
Agent-facing tab discovery and handover/close previews show generic tab labels
and site origins. Full titles and addresses remain in your browser UI; page
details reach the assistant only through a permitted, inspected page read.

Pages you open are under your control. Use the handover control after signing in
to let JARVIS use a non-sensitive page, or take control at any time. Login,
payment and credential-entry pages remain manual. Some providers, including
Google OAuth, require the system browser instead of an embedded sign-in.
Visible credential controls stay manual even beyond the bounded action list.
Sign-in tokens in URL fragments are also protected; pages exceeding the
inspection limit require direct use and return no page content to JARVIS.
Credential query parameters, including API keys and session tokens, remain manual.
Pages exposing credential-bearing links also remain manual before their text or
link metadata is returned to the assistant.
Before a click or text entry, the browser repeats its page and credential checks
inside the same isolated JavaScript dispatch. A newly sensitive or changed page
blocks that input rather than relying only on an earlier inspection.

Each task is bound to its own page target. Switching the visible tab does not
redirect a prepared action. Navigation, manual takeover, closing a tab and Stop
invalidate old snapshots. Clicking, typing, handing over a tab and closing one
through JARVIS require exact review; navigating an already loaded tab also needs
review because it may discard work. Isolated project workers cannot use browser
sessions. Native page surfaces hide while Settings or action approvals are open.
Control and snapshot authority are checked again immediately before renderer
input, navigation or closure. Stop and manual takeover revoke further dispatch;
an operation already dispatched may still finish. Inspect uncertain effects
before retrying; cancellation cannot undo an interaction already sent.

## Phone compatibility and release status

Existing paired phones keep ordinary workflows. Older clients cannot approve a
visual action whose image they cannot display: approve on the Mac instead.
Updated mobile source supports image previews, but Android distribution remains
on hold while the existing Play Protect classification appeal is unresolved.

0.8.0 is a development candidate until independent review, trusted CI, owner review,
exact-commit signing approval and installed acceptance are completed. Mock protocol
checks and rendered UI previews do not establish installed desktop behavior or
compatibility with real third-party accounts/models/apps.

## Specialist subagents

In Settings → Autonomy, enable **Allow parallel specialist workers** if you want
JARVIS to delegate analysis, planning or code review. It uses your selected task
provider/model, with additional inference usage. Ask, for example: “Delegate a
review of these selected project files, then compare the findings.”

Workers receive explicit context and selected immutable text snapshots only;
they do not inherit the full conversation, account tools or desktop controls.
They cannot write files, run commands, browse, use plugins, spawn more workers or
approve actions. JARVIS reviews their findings and performs approved work itself.
A worker's assessment never satisfies the independent repository or owner review.

Jobs shows progress, tool/token usage, shared-file hashes and findings. You can
cancel a worker there. Stop, corrections, parent completion or disabling subagents
cancel active workers. Restart preserves findings as interrupted records and
never automatically reruns inference or tools.

Limits: two concurrent workers, six per job, five minutes and twenty tool calls
per worker. Tool calls also count against the parent job. The reported-token
cutoff is 40,000; an in-flight response may exceed it. Share up to eight project
files, 100 KB each and 200 KB total, plus 24,000 characters of context. In-flight
provider requests may still incur usage after cancellation. Worker findings are
untrusted analysis and must be checked before acting.

### Project job boundaries

Project jobs have a closed tool scope in the main broker dispatch, in addition to
the command sandbox. They can work in their isolated project, ask questions,
record progress and use enabled read-only specialists. Host file bridges require
the operator's picker or exact import/export review. App, browser, account, phone,
plugin, global memory and job-management tools are unavailable to project jobs,
even under Autopilot. Unknown tools are denied.

Maintenance roles are bound to the active job and its stored proposal. Proposers
can submit only their own draft; reviewers can inspect their own proposal and
its designated proposer artifacts and record a review. Publishing, merging and
privileged release builds remain foreground operator actions. Project task status
contains only that task's broker activity and approvals; unrelated owner actions
are not attributed to the project. Queued requests recheck the originating task
and scope before planning and execution.

Worker admissions have a durable per-job counter separate from the bounded
result history. Cancellation, failure, follow-up tasks, restarts and pruning never
refund the six admissions. A slot is recorded before inference begins. Counters
remain for stored job IDs even after results disappear from the display. If old
or damaged state lacks a trustworthy ledger, pre-existing jobs cannot delegate
again; start a new job for a fresh budget. Unknown budgets always fail closed, even with no result history. Only the trusted
job manager can register a newly created job for a fresh budget; resuming or
continuing an old job cannot do so.
