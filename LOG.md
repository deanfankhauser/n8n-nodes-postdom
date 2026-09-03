2026-09-03 — nine destinations, and the connect picker narrowed to the ones with a redirect

- Both platform pickers were a hardcoded four (Instagram, LinkedIn, TikTok, YouTube), written out
  twice and deriving from nothing. Both are now derived from one list in `PostdomRequests.ts`,
  mirroring `CONNECT_DESTINATIONS` in `@postdom/core`, which this package cannot import because it
  ships standalone.
- The two pickers answer different questions and now offer different lists. Media upload offers all
  nine connectable destinations, because it asks what the video is validated for. Account → Connect
  offers only the eight that authorise by redirect.
- Bluesky is deliberately absent from Account → Connect. It authorises with an app password and has
  no authorization URL, so a picker feeding an operation that returns an OAuth URL would ship a
  control that cannot succeed and surface an error naming our supplier. It is connected by a human
  in the Postdom dashboard. Same narrowing the MCP `connect_account` tool has.
- `n8n-nodes-postdom@0.4.0` is published from this commit through OIDC trusted publishing. The
  artifact it replaces, `0.3.0`, knew three destinations, so upgrading widens the menu from three to
  nine. Re-submitting the Creator Portal listing is a separate act that has not happened: the
  listing still describes `0.3.0`, and whether re-submitting during an open manual review resets or
  supersedes the reviewed version is unanswered.
- The production closed-loop test remains unobserved and unchecked. The demo video is still Dean's.

2026-09-01 — n8n release and submission record reconciliation

- `n8n-nodes-postdom@0.3.0` is the live npm artifact (`latest=0.3.0`, confirmed against the registry). Package metadata here now records 0.3.0; the 0.2.0 line below is retained as the historical entry it was.
- Creator Portal state is submitted with automated review complete and manual review awaiting an uncut demo video. Not listed, not approved, not verified. The demo video is Dean's artifact.
- The production closed-loop test has never been observed and stays unchecked. Template library publication has not happened and every library URL stays null.

2026-08-28 — n8n media upload lane

- Added the Media Upload and Get Status operations against the merged core REST contract.
- Kept binary bytes off the Postdom API and kept the Postdom credential off the signed storage PUT.
- Added bounded status polling with exact pending, stored, and failed outcomes; upload URLs never enter node output.
- Extended Publish Video with an exactly-one URL-or-handle source while retaining the legacy URL template.
- Prepared `n8n-nodes-postdom@0.2.0` for individual audit; marketplace publication remains held.
