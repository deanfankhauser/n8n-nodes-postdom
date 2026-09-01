# n8n-nodes-postdom

Use [Postdom](https://postdom.com) in n8n to schedule and publish short-form video to TikTok, Instagram Reels, and YouTube Shorts, then read approval-aware outcomes and normalized performance. The node works as an AI Agent tool and exposes the same agent-authority social media API and MCP boundary as Postdom's hosted Connect Layer. It also uploads video directly to private Postdom storage and submits bounded publication plans.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Postdom Trigger](#postdom-trigger)
- [Approval-aware outcomes](#approval-aware-outcomes)
- [Workflow templates](#workflow-templates)
- [Worked examples](#worked-examples)
- [Zero-install alternative: the hosted MCP endpoint](#zero-install-alternative-the-hosted-mcp-endpoint)
- [Development](#development)
- [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

On self-hosted n8n:

1. Go to **Settings > Community Nodes**.
2. Select **Install**.
3. Enter `n8n-nodes-postdom` and confirm.

Availability inside n8n Cloud requires n8n's verification review; until then, use a self-hosted instance or the [hosted MCP endpoint](#zero-install-alternative-the-hosted-mcp-endpoint), which needs no installation at all.

## Credentials

The node authenticates with a **Postdom workspace agent key** (`pd_live_...`).

Where the key comes from:

1. A human signs up or logs in at [app.postdom.com](https://app.postdom.com).
2. In the dashboard, open **Accounts** and find the **Agent keys** section.
3. Create a key with the scopes you need: `read` for all Get and List operations, plus `write` for Connect, Media Upload, Submit Plan, and Publish Video.
4. Paste the key into the n8n credential's **API Key** field. n8n stores it encrypted and masks it in the UI.

Credential fields:

| Field | Default | Notes |
| --- | --- | --- |
| API Key | — | The `pd_live_` workspace agent key. |
| Base URL | `https://api.postdom.com` | Postdom API origin. Keep the default unless Postdom directs you elsewhere. |

The credential test calls `GET /v1/workspace/status`, so a freshly saved credential verifies against your real workspace immediately.

Agent keys are agent-authority credentials: they can never approve their own work, touch billing, or reach any human dashboard route. Approvals always stay with a human in the Postdom dashboard.

## Operations

| Resource | Operation | What it does |
| --- | --- | --- |
| Workspace | Get Status | Connected-account health, autonomy and policy state, brief version, activity counts, billing state, and the connection gate. |
| Account | Get Many | Get the connected destination accounts (one n8n item per account). |
| Account | Connect | Create a platform OAuth URL for TikTok, Instagram, or YouTube. Hand the URL to a human. |
| Account | Get Performance | Normalized performance snapshot for one account over a 7d or 30d window. |
| Account | Get Best Posts | Rank an account's posts by an evidence-backed metric (views, likes, comments, shares, saves, watch time, average watch %, completion %, follower delta). |
| Media | Upload | Read an MP4 or QuickTime n8n binary property, obtain a scoped upload contract, PUT the bytes directly to private storage, and return an opaque media handle/status. |
| Media | Get Status | Read whether a media handle is `pending`, `stored`, or `failed`. |
| Plan | Submit | Submit a time-bounded publication plan (max 14 days, max 20 posts) for one human approval. |
| Plan | Get | Read plan status and structured reviewer feedback. |
| Post | Publish Video | Create a private-by-default, AI-disclosed short-form video publish, optionally scheduled in UTC. Plan ID, Intent, and Agent Identity are first-class fields. |
| Post | Get | Read publish state and any approval feedback. |
| Post | Get Performance | Normalized performance snapshot for one post. |
| Brief | Get | The workspace-owned brand guidance to read before planning or writing content. |
| Digest | Get | The latest completed weekly digest of observed outcomes. |

Every Postdom API write request carries an `Idempotency-Key` header. Leave the optional Idempotency Key field empty and the node generates a fresh key per execution; set it explicitly when you want retries to be deduplicated across executions. API requests identify themselves with `X-Postdom-Source: n8n`. The binary PUT is different by design: it goes straight to the single short-lived signed storage URL with only the exact returned `Content-Type` and `Content-Length`; the Postdom credential and source header are never sent to storage.

## Postdom Trigger

**Postdom Trigger** is a separate polling trigger node ("Post Status"). Give it a comma-separated list of post IDs (as returned by Publish Video) and it starts the workflow when a watched post reaches a **terminal** state: `published`, `partial`, `failed`, `rejected`, `missed_approval`, or `missed_schedule`. In-flight states (`draft`, `requires_approval`, `changes_requested`, `scheduled`, `publishing`) never fire.

- Each emitted item is the full post read plus `terminal: true` and a `postdom_n8n_guidance` object with approval/polling guidance.
- Deduplication uses n8n workflow static data: a post fires once per terminal state, across polls and n8n restarts.
- Testing the trigger manually emits the current snapshot of every watched post (terminal or not) so you can build the rest of the workflow against real data.
- The trigger polls each watched ID individually because agent credentials are scoped to per-post reads; Postdom does not expose an agent-scope list-posts endpoint yet.

## Approval-aware outcomes

Postdom is agent-native: agents propose, humans keep approval authority. The node encodes that instead of mirroring HTTP:

- **A publish that lands in review is a success, never an error.** Publish Video, Post Get, Plan Submit, and Plan Get responses carry local `postdom_n8n_guidance`: `{ state, terminal, requires_human, guidance }`. A publish with `status: requires_approval` returns `postdom_n8n_guidance.requires_human: true` and guidance pointing at the dashboard approval and the trigger — the workflow keeps running.
- **Plan-first is a first-class flow.** Submit Plan → one human approval → Publish Video with the Plan ID field set; publishes inside the plan's window and budget flow without per-post review. `postdom_n8n_guidance` on Plan Get tells you exactly when to start publishing.
- **Server evidence is never guidance.** API `outcome` remains untouched, including measured values, availability state, reason, source, observation timestamps, and nulls. The node never invents `outcome` when the API omits it. If the API ever uses the reserved `postdom_n8n_guidance` namespace, the node fails visibly rather than overwriting data.
- **Versioned guidance namespace.** The `0.3.0` node and its templates use `postdom_n8n_guidance`; do not pair these templates with the older `0.2.0` field layout.
- **Performance reads are honest.** Metric availability states (`available`, `delayed(2-3d)`, `estimable`, `never`, `unverified`) are passed through per metric with reasons. Unavailable metrics stay `null`; they are never coerced to zero, and failed publishes are reported ineligible instead of measuring nothing quietly.

## Workflow templates

Importable n8n workflow exports live in [`templates/`](templates/):

| Template | Flow |
| --- | --- |
| `upload-media-then-publish.json` | Read a local video binary → Upload directly to private storage → Publish Video using the returned media handle. |
| `publish-video-await-terminal-get-performance.json` | Existing public Video URL → Publish Video to TikTok + Reels → wait/poll until `postdom_n8n_guidance.terminal` → Get Performance. |
| `plan-first-approval-then-publish.json` | Submit Plan → `requires_approval` handled as the designed success path → poll Plan Get until approved → Publish Video under the plan ID. |
| `weekly-digest-to-webhook.json` | Weekly schedule → Get Digest → format → notify a Slack-compatible webhook. |
| `post-terminal-trigger-performance-report.json` | Postdom Trigger (Post Status) → Get Performance → formatted report to a webhook. |

Import via **Workflows → Add workflow → Import from file**, then attach your Postdom credential (templates ship without credential references) and replace the placeholder account IDs, URLs, and webhook.

## Worked examples

### Workspace: morning health check

1. Add a **Schedule Trigger** (every morning).
2. Add **Postdom** with Resource `Workspace`, Operation `Get Status`.
3. Branch on `{{ $json.connect_gate.enabled }}` or `{{ $json.billing.publishing_allowed }}` and alert your team when publishing is blocked.

### Account: get accounts and connect a new one

1. Add **Postdom** with Resource `Account`, Operation `Get Many`. Each connected account arrives as its own item with `providerAccountId`, `platform`, `handle`, `trust_level`, and `paused`.
2. To add a destination, use Resource `Account`, Operation `Connect` with Platform `TikTok`. The response contains a `connect_url`; send it to a human (for example via Slack or email). They finish the platform OAuth flow themselves — no passwords ever pass through n8n.
3. For measurement, use Operation `Get Performance` with an Account ID from step 1 and Window `7 Days`.
4. For ranking, use Operation `Get Best Posts` with Metric `Views` — null observations are excluded with reasons, never ranked as zero.

### Plan: submit a weekly plan for approval

1. Add **Postdom** with Resource `Plan`, Operation `Submit`.
2. Set Account IDs `acc_123, acc_456` (from Account Get Many), Title `Week 36 push`, Objective `Grow saves on product explainers`, Starts At `2026-09-01T09:00:00Z`, Ends At `2026-09-08T09:00:00Z`, Max Posts `5`, Intent `Scheduled weekly plan from n8n`.
3. The response comes back with `status: requires_approval` and `postdom_n8n_guidance.guidance` — that is the designed success path, not an error. The plan waits for one human approval in the Postdom dashboard. Poll it with Resource `Plan`, Operation `Get` using the returned plan ID, and read the reviewer's structured feedback from the response.

### Post: publish a video

1. Add **Postdom** with Resource `Post`, Operation `Publish Video`.
2. Choose exactly one Video Source: a Media Handle returned by Media Upload, or the existing Video URL path for a publicly fetchable file. Set Account IDs, Caption, and Intent. Set the Plan ID field to publish under an approved plan, and Agent Identity to tell the human reviewer who is publishing. Optionally set Publish At (UTC) under Additional Fields.
3. Every publish is created private-by-default and AI-disclosed on each platform (TikTok `SELF_ONLY`, Instagram reel flagged as AI-generated, YouTube `private` with synthetic-media disclosure). Posts flow automatically inside an account's policy or await human review on review-mode accounts; landing in review returns a success item with `postdom_n8n_guidance.guidance`, never an error.
4. Read the outcome with Operation `Get` (or the **Postdom Trigger**), then measure with Operation `Get Performance` once the post has been live for a while.

### Media: upload a private video

Supply the actual video's positive-integer **Video Width (Pixels)**, **Video Height (Pixels)**, and **Video Duration (Seconds)**. Their unset zero values are rejected, not usable defaults. Map measured metadata; the file-reading node alone does not extract dimensions or duration. Postdom validates the selected platforms before issuing the signed upload contract. No codec or runtime dependency is added to this node.

The `0.3.0` node requires measured width, height, and duration so Postdom can validate every selected destination before issuing an upload contract.

1. Produce an n8n binary property containing `video/mp4` or `video/quicktime` bytes (for example with Read/Write Files from Disk or an HTTP Request node).
2. Add **Postdom** with Resource `Media`, Operation `Upload`; name the binary property and choose the intended destination platforms. The node asks Postdom for a workspace-scoped, short-lived PUT contract, then sends the bytes directly to private storage. Video bytes never pass through the Postdom API process.
3. Leave Wait for Storage on to poll with bounded backoff. The node returns the exact `pending`, `stored`, or `failed` state; a timeout is an honest `pending`, not a fabricated success. The temporary upload URL is never included in node output.
4. Pass `media_handle` to Post → Publish Video with Video Source `Media Handle`. You may also use Media → Get Status separately.

### Brief: fetch guidance before generating content

1. Add **Postdom** with Resource `Brief`, Operation `Get` at the start of any content-generation workflow.
2. Feed the returned brand guidance into your generation step (for example an AI Agent or LLM node) so generated captions stay inside the workspace's voice.

### Digest: weekly outcomes into your team channel

1. Add a **Schedule Trigger** (weekly).
2. Add **Postdom** with Resource `Digest`, Operation `Get`.
3. Post the digest summary to Slack or email. The digest describes observed outcomes and coverage gaps; it does not recommend actions.

## Zero-install alternative: the hosted MCP endpoint

You do not need this package installed to use Postdom from n8n. Postdom ships a hosted [Model Context Protocol](https://modelcontextprotocol.io/) endpoint that n8n's built-in **MCP Client Tool** node can call today:

1. In an AI Agent workflow, add the **MCP Client Tool** node.
2. Set the **Endpoint** to `https://api.postdom.com/mcp`.
3. Set **Server Transport** to HTTP Streamable.
4. Set **Authentication** to Bearer and use your `pd_live_` workspace agent key (store it as an n8n credential, never inline).
5. The agent auto-discovers the tools available from the hosted endpoint. The separately installed npm package is `@postdom/mcp@0.3.0`.

Use the MCP path when an LLM should decide which Postdom capability to call; use this node when you want deterministic, field-by-field control inside a classic n8n workflow.

## Development

```bash
npm install
npm run typecheck   # tsc must pass
npm run lint        # eslint, config consistent with the postdom repo
npm test            # vitest: REST request shapes, outcome/trigger logic, node descriptions, template validity
npm run build       # compiles to dist/ and copies node icons
```

The request builders in `nodes/Postdom/PostdomRequests.ts` mirror the request shapes of `PostdomClient` in the official `@postdom/mcp` package; the unit tests in `test/PostdomRequests.test.ts` pin those shapes (paths, headers, exact JSON body keys, platform target defaults) without any network access. `test/NodeShapes.test.ts` pins both node descriptions (trigger wiring, Get Many naming, prominent plan/identity fields), and `test/templates.test.ts` validates every workflow template as an importable n8n export.

Publishing happens exclusively through GitHub Actions with npm provenance (see [`.github/workflows/publish.yml`](.github/workflows/publish.yml)), as required for n8n verified community nodes.

## Resources

- [Postdom developer docs](https://postdom.com/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](https://github.com/deanfankhauser/n8n-nodes-postdom/blob/main/LICENSE.md)
