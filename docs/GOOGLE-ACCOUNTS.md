# Gmail and Google Calendar connections

JARVIS 0.7.0 adds **Settings → Plugins** on the Mac. Google account commissioning is required before real use; the 0.6.2 apps do not include this feature.

After updating an existing installation, start a new conversation once before using the new account tools. Existing chat history remains available; this loads the current tool definitions for the new conversation.

Connect each service separately. Read-only access is the default. Optional sending or event creation asks Google for an additional scope; every email or event still requires JARVIS's exact, single-use approval. The primary calendar is supported. Attachments, mailbox modification, existing-event edits/deletion and shared-calendar selection are not implemented.

## Personal setup

1. In your own Google Cloud project, enable **Gmail API** and **Google Calendar API**. A Firebase service account is not a user OAuth client.
2. Configure Google Auth Platform branding, audience and data access. For an external app in Testing, add your own Google account under test users. Review Google's consent and terms yourself.
3. Create an OAuth client with application type **Desktop app**, then download its JSON. JARVIS only accepts the `installed` client format. Keep the file out of source control and chat.
4. In JARVIS Settings, import that JSON. The imported copy is encrypted using the Mac's credential store; the original downloaded file remains where you saved it.
5. Leave optional write permissions off initially. Choose Connect Gmail or Connect Google Calendar, select your account in the system browser, and review Google's exact permission prompt. You can cancel from JARVIS.
6. Verify the connected email address and access mode. To add or remove a write permission, change the checkbox and reconnect. A cancelled or partially granted sign-in preserves the previous local connection.

Google's external Testing refresh tokens for these scopes expire after seven days. Reconnect when needed. Personal/testing exceptions do not constitute approval for a broadly distributed public OAuth client. Gmail read access is a restricted scope; public deployment needs a separate verification/privacy review. Friends testing independent copies should configure their own clients and accounts.

## Ask JARVIS

- “Find unread messages from this week and summarize them.”
- “What is on my primary calendar tomorrow?” Give a timezone if the intended time is ambiguous.
- “Send an email to this exact address with this subject and message.” Enable approved sending first, then inspect sender, recipients and the full body before approval.
- “Create a meeting from 10 to 11 tomorrow, invite this exact address.” Enable approved event creation first; check dates, timezone offset and all invitation recipients before approval.

Connected tools are available to the same desktop assistant when requested through a paired phone. Setup, credential import and Google account sign-in stay on the Mac. Tokens are never returned to the phone or renderer. No inbox/calendar monitoring is enabled by connecting.

## Privacy and disconnection

Refresh/access tokens and the OAuth client configuration are encrypted on this Mac. Requested email and calendar content enters the task context, may be sent to the configured AI provider, and can persist in local plaintext chat/task history. This is not end-to-end encryption for history. Only connect accounts you intend the paired assistant to use.

Disconnect deletes this service's locally stored connection, invalidates pending approval targets, and leaves existing chat history. It does not revoke the provider grant. **Manage Google access** opens Google's account connections page; revoking the common client there can affect both Gmail and Calendar. Disconnect both before replacing a client.

Sends/creates are not automatically retried. If the connection fails after submission, check Sent mail or the calendar before repeating: the remote effect may already have happened. Google accepting an email or event invitation is not proof that a recipient received it. Stop cancels pending broker approvals and requests; it cannot undo an email/event already accepted by Google.

## Implementation and verification

Desktop authorization uses a temporary loopback listener bound only to `127.0.0.1`, random state, PKCE S256, a three-minute deadline and a system-browser sign-in. Google endpoints are fixed, HTTP redirects are rejected, responses are bounded, and credentials are never rendered or logged. Read results are bounded and labelled untrusted. All mutation targets and bodies are captured before approval and checked against the account generation before execution.

Automated tests cover the real local callback, wrong-state rejection, PKCE, cancel, single-use approval, decline/Stop, account changes, input injection, invitation previews, partial scopes, response bounds and refresh/disconnect races using synthetic credentials. These do not replace owner sign-in and real-account read/write acceptance.

Official references: [Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
