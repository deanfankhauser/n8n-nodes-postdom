import { randomUUID } from 'crypto';

/**
 * Pure request builders for the Postdom REST API.
 *
 * These mirror the request shapes produced by PostdomClient in the official
 * @postdom/mcp package (packages/mcp/src/index.ts in the postdom repository):
 * same paths, same JSON body keys, same platform target defaults. Keeping them
 * pure (no I/O, no n8n imports) lets unit tests assert the exact REST shapes.
 */

export const DEFAULT_BASE_URL = 'https://api-web-production-4094.up.railway.app';

export const SOURCE_HEADER = 'X-Postdom-Source';
export const SOURCE_VALUE = 'n8n';

export type PostdomPlatform = 'tiktok' | 'instagram' | 'youtube';

export const MEDIA_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const;
export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

export const MEDIA_UPLOAD_STATUSES = ['pending', 'stored', 'failed'] as const;
export type MediaUploadStatus = (typeof MEDIA_UPLOAD_STATUSES)[number];

export const MEDIA_MAX_BYTES = 500 * 1024 * 1024;
export const MEDIA_HANDLE_PATTERN = /^pd_media_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PerformanceWindow = '7d' | '30d';

export type PerformanceMetric =
	| 'views'
	| 'likes'
	| 'comments'
	| 'shares'
	| 'saves'
	| 'watch_time_s'
	| 'avg_watch_pct'
	| 'completion_pct'
	| 'follower_delta';

export interface PostdomAccount {
	providerAccountId: string;
	platform: string;
}

export interface PostdomRequest {
	method: 'GET' | 'POST';
	url: string;
	headers: Record<string, string>;
	body?: Record<string, unknown>;
	json: true;
}

export interface MediaUploadContract {
	media_handle: string;
	upload_url: string;
	method: 'PUT';
	headers: {
		'Content-Type': string;
		'Content-Length': string;
	};
	expires_at: string;
}

export interface MediaStatusResponse {
	media_handle: string;
	status: MediaUploadStatus;
	content_type: MediaContentType;
	size_bytes: number;
	media_url: string | null;
	failure_reason: string | null;
}

export interface DirectMediaPutRequest {
	method: 'PUT';
	url: string;
	headers: {
		'Content-Type': string;
		'Content-Length': string;
	};
	body: Buffer;
}

export function normalizeBaseUrl(raw: string | undefined): string {
	const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
	return trimmed === '' ? DEFAULT_BASE_URL : trimmed;
}

function readHeaders(): Record<string, string> {
	return {
		Accept: 'application/json',
		[SOURCE_HEADER]: SOURCE_VALUE,
	};
}

function writeHeaders(idempotencyKey?: string): Record<string, string> {
	return {
		...readHeaders(),
		'Idempotency-Key': idempotencyKey === undefined || idempotencyKey === '' ? randomUUID() : idempotencyKey,
	};
}

function get(baseUrl: string, path: string): PostdomRequest {
	return {
		method: 'GET',
		url: `${baseUrl}${path}`,
		headers: readHeaders(),
		json: true,
	};
}

export function buildGetWorkspaceStatus(baseUrl: string): PostdomRequest {
	return get(baseUrl, '/v1/workspace/status');
}

export function buildGetBrief(baseUrl: string): PostdomRequest {
	return get(baseUrl, '/v1/brief');
}

export function buildGetDigest(baseUrl: string): PostdomRequest {
	return get(baseUrl, '/v1/digest');
}

export interface CreateMediaUploadInput {
	contentType: MediaContentType;
	sizeBytes: number;
	platforms: PostdomPlatform[];
	idempotencyKey?: string;
}

export function buildCreateMediaUpload(
	baseUrl: string,
	input: CreateMediaUploadInput,
): PostdomRequest {
	if (!(MEDIA_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
		throw new Error('Media content type must be video/mp4 or video/quicktime');
	}
	if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MEDIA_MAX_BYTES) {
		throw new Error(`Media size must be between 1 and ${MEDIA_MAX_BYTES} bytes`);
	}
	if (input.platforms.length < 1 || input.platforms.length > 3) {
		throw new Error('Choose between one and three target platforms');
	}
	if (new Set(input.platforms).size !== input.platforms.length) {
		throw new Error('Target platforms must be unique');
	}
	return {
		method: 'POST',
		url: `${baseUrl}/v1/media/uploads`,
		headers: writeHeaders(input.idempotencyKey),
		body: {
			content_type: input.contentType,
			size_bytes: input.sizeBytes,
			platforms: input.platforms,
		},
		json: true,
	};
}

export function buildGetMediaStatus(baseUrl: string, mediaHandle: string): PostdomRequest {
	assertMediaHandle(mediaHandle);
	return get(baseUrl, `/v1/media/${encodeURIComponent(mediaHandle)}`);
}

export function parseMediaUploadContract(
	value: Record<string, unknown>,
	expectedContentType: MediaContentType,
	expectedSizeBytes: number,
	now = Date.now(),
): MediaUploadContract {
	const headers = value.headers;
	if (
		typeof value.media_handle !== 'string' ||
		!MEDIA_HANDLE_PATTERN.test(value.media_handle) ||
		typeof value.upload_url !== 'string' ||
		!isUrl(value.upload_url) ||
		value.method !== 'PUT' ||
		typeof headers !== 'object' ||
		headers === null ||
		Array.isArray(headers) ||
		typeof value.expires_at !== 'string'
	) {
		throw new Error('Postdom returned an invalid media upload contract');
	}
	const returnedHeaders = headers as Record<string, unknown>;
	if (
		returnedHeaders['Content-Type'] !== expectedContentType ||
		returnedHeaders['Content-Length'] !== String(expectedSizeBytes)
	) {
		throw new Error('Postdom returned media upload headers that do not match the binary');
	}
	const expiresAt = Date.parse(value.expires_at);
	if (!Number.isFinite(expiresAt) || expiresAt <= now) {
		throw new Error('Postdom returned an expired media upload contract');
	}
	return {
		media_handle: value.media_handle,
		upload_url: value.upload_url,
		method: 'PUT',
		headers: {
			'Content-Type': expectedContentType,
			'Content-Length': String(expectedSizeBytes),
		},
		expires_at: value.expires_at,
	};
}

export function buildDirectMediaPut(
	contract: MediaUploadContract,
	bytes: Buffer,
): DirectMediaPutRequest {
	if (contract.headers['Content-Length'] !== String(bytes.byteLength)) {
		throw new Error('Binary byte length does not match the signed upload contract');
	}
	return {
		method: contract.method,
		url: contract.upload_url,
		headers: { ...contract.headers },
		body: bytes,
	};
}

export function parseMediaStatus(value: Record<string, unknown>): MediaStatusResponse {
	if (
		typeof value.media_handle !== 'string' ||
		!MEDIA_HANDLE_PATTERN.test(value.media_handle) ||
		!MEDIA_UPLOAD_STATUSES.includes(value.status as MediaUploadStatus) ||
		!MEDIA_CONTENT_TYPES.includes(value.content_type as MediaContentType) ||
		typeof value.size_bytes !== 'number' ||
		!Number.isInteger(value.size_bytes) ||
		value.size_bytes < 1 ||
		!(value.media_url === null || (typeof value.media_url === 'string' && isUrl(value.media_url))) ||
		!(value.failure_reason === null || typeof value.failure_reason === 'string')
	) {
		throw new Error('Postdom returned an invalid media status');
	}
	return value as unknown as MediaStatusResponse;
}

export interface WaitForMediaOptions {
	timeoutMs: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	now?: () => number;
	sleep?: (milliseconds: number) => Promise<void>;
}

export async function waitForMediaStorage(
	readStatus: () => Promise<MediaStatusResponse>,
	options: WaitForMediaOptions,
): Promise<MediaStatusResponse> {
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
	const startedAt = now();
	let delayMs = options.initialDelayMs ?? 1_000;
	const maxDelayMs = options.maxDelayMs ?? 10_000;
	let status = await readStatus();
	while (status.status === 'pending') {
		const remainingMs = options.timeoutMs - (now() - startedAt);
		if (remainingMs <= 0) return status;
		await sleep(Math.min(delayMs, remainingMs));
		status = await readStatus();
		delayMs = Math.min(delayMs * 2, maxDelayMs);
	}
	return status;
}

export function buildListAccounts(baseUrl: string): PostdomRequest {
	return get(baseUrl, '/v1/accounts');
}

export function buildGetPlan(baseUrl: string, planId: string): PostdomRequest {
	return get(baseUrl, `/v1/plans/${encodeURIComponent(planId)}`);
}

export function buildGetPost(baseUrl: string, postId: string): PostdomRequest {
	return get(baseUrl, `/v1/posts/${encodeURIComponent(postId)}`);
}

export function buildGetPostPerformance(baseUrl: string, postId: string): PostdomRequest {
	return get(baseUrl, `/v1/posts/${encodeURIComponent(postId)}/performance`);
}

export function buildGetAccountPerformance(
	baseUrl: string,
	accountId: string,
	window: PerformanceWindow,
): PostdomRequest {
	return get(baseUrl, `/v1/accounts/${encodeURIComponent(accountId)}/performance?window=${window}`);
}

export function buildGetBestPosts(
	baseUrl: string,
	accountId: string,
	metric: PerformanceMetric,
	window: PerformanceWindow,
): PostdomRequest {
	return get(
		baseUrl,
		`/v1/accounts/${encodeURIComponent(accountId)}/best-posts?metric=${encodeURIComponent(metric)}&window=${window}`,
	);
}

export interface ConnectAccountInput {
	platform: PostdomPlatform;
	redirectUrl: string;
	idempotencyKey?: string;
}

export function buildConnectAccount(baseUrl: string, input: ConnectAccountInput): PostdomRequest {
	return {
		method: 'POST',
		url: `${baseUrl}/v1/accounts/connect`,
		headers: writeHeaders(input.idempotencyKey),
		body: {
			platform: input.platform,
			redirect_url: input.redirectUrl,
		},
		json: true,
	};
}

export interface SubmitPlanInput {
	accountIds: string[];
	title: string;
	objective: string;
	startsAt: string;
	endsAt: string;
	maxPosts: number;
	briefVersion?: number;
	intent: string;
	agentIdentity?: string;
	idempotencyKey?: string;
}

export function buildSubmitPlan(
	baseUrl: string,
	input: SubmitPlanInput,
	accounts: PostdomAccount[],
): PostdomRequest {
	const byId = new Map(accounts.map((account) => [account.providerAccountId, account]));
	const targets = input.accountIds.map((accountId) => {
		const account = byId.get(accountId);
		if (!account) throw new Error(`Postdom account ${accountId} is not connected`);
		return { account_id: accountId, platform: account.platform };
	});
	const body: Record<string, unknown> = {
		title: input.title,
		objective: input.objective,
		starts_at: input.startsAt,
		ends_at: input.endsAt,
		max_posts: input.maxPosts,
		targets,
		agent_context: {
			identity: agentIdentity(input.agentIdentity),
			intent: input.intent,
		},
	};
	if (input.briefVersion !== undefined) body.brief_version = input.briefVersion;
	return {
		method: 'POST',
		url: `${baseUrl}/v1/plans`,
		headers: writeHeaders(input.idempotencyKey),
		body,
		json: true,
	};
}

export interface PublishVideoInput {
	accountIds: string[];
	videoUrl?: string;
	mediaHandle?: string;
	caption: string;
	intent: string;
	agentIdentity?: string;
	publishAt?: string;
	planId?: string;
	idempotencyKey?: string;
}

export function buildPublishVideo(
	baseUrl: string,
	input: PublishVideoInput,
	accounts: PostdomAccount[],
): PostdomRequest {
	const videoUrl = input.videoUrl?.trim();
	const mediaHandle = input.mediaHandle?.trim();
	if (Number(Boolean(videoUrl)) + Number(Boolean(mediaHandle)) !== 1) {
		throw new Error('Provide exactly one of Video URL or Media Handle');
	}
	if (videoUrl !== undefined && videoUrl !== '' && !isUrl(videoUrl)) {
		throw new Error('Video URL must be a valid URL');
	}
	if (mediaHandle !== undefined && mediaHandle !== '') assertMediaHandle(mediaHandle);
	const byId = new Map(accounts.map((account) => [account.providerAccountId, account]));
	const targets = input.accountIds.map((accountId) => {
		const account = byId.get(accountId);
		if (!account) throw new Error(`Postdom account ${accountId} is not connected`);
		return defaultTarget(account.platform, accountId, input.caption);
	});
	const body: Record<string, unknown> = {
		caption: input.caption,
		targets,
		agent_context: {
			identity: agentIdentity(input.agentIdentity),
			intent: input.intent,
		},
	};
	if (videoUrl !== undefined && videoUrl !== '') body.media_url = videoUrl;
	if (mediaHandle !== undefined && mediaHandle !== '') body.media_handle = mediaHandle;
	if (input.publishAt !== undefined) body.publish_at = input.publishAt;
	if (input.planId !== undefined) body.plan_id = input.planId;
	return {
		method: 'POST',
		url: `${baseUrl}/v1/posts`,
		headers: writeHeaders(input.idempotencyKey),
		body,
		json: true,
	};
}

function assertMediaHandle(value: string): void {
	if (!MEDIA_HANDLE_PATTERN.test(value)) {
		throw new Error('Media Handle must be a valid Postdom media handle');
	}
}

function isUrl(value: string): boolean {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

function agentIdentity(value: string | undefined): string {
	const trimmed = value?.trim();
	return trimmed === undefined || trimmed === '' ? 'AI agent via n8n' : trimmed;
}

// ---------------------------------------------------------------------------
// Outcome interpretation (pure, shared by the action node and the trigger)
// ---------------------------------------------------------------------------

/**
 * Post statuses after which the Postdom API will never move the post again.
 * Mirrors the `post_status` enum in the Postdom schema; the five non-terminal
 * states are draft, requires_approval, changes_requested, scheduled, publishing.
 */
export const TERMINAL_POST_STATUSES = [
	'published',
	'partial',
	'failed',
	'rejected',
	'missed_approval',
	'missed_schedule',
] as const;

export type TerminalPostStatus = (typeof TERMINAL_POST_STATUSES)[number];

export function isTerminalPostStatus(status: unknown): status is TerminalPostStatus {
	return (
		typeof status === 'string' && (TERMINAL_POST_STATUSES as readonly string[]).includes(status)
	);
}

export interface PolledPostStatus {
	postId: string;
	status: string;
}

/**
 * Trigger dedup: given the freshly polled statuses and the map of statuses
 * already emitted per post (from n8n workflow static data), return which posts
 * to emit now and the next static-data map. A post emits when it sits in a
 * terminal state that has not been emitted for it before; a later terminal
 * transition (for example partial -> failed on a retry backfill) emits again.
 */
export function selectTerminalEmissions(
	polled: PolledPostStatus[],
	emitted: Record<string, string>,
): { emit: PolledPostStatus[]; nextEmitted: Record<string, string> } {
	const nextEmitted = { ...emitted };
	const emit: PolledPostStatus[] = [];
	for (const post of polled) {
		if (!isTerminalPostStatus(post.status)) continue;
		if (nextEmitted[post.postId] === post.status) continue;
		nextEmitted[post.postId] = post.status;
		emit.push(post);
	}
	return { emit, nextEmitted };
}

export interface PostdomOutcome {
	state: string;
	terminal: boolean;
	requires_human: boolean;
	guidance: string;
}

/**
 * Approval-aware read of a post/publish status. A publish that lands in review
 * is a SUCCESS state with guidance, never an error: Postdom is built so agents
 * propose and humans keep approval authority.
 */
export function publishOutcome(status: unknown): PostdomOutcome {
	switch (status) {
		case 'requires_approval':
			return {
				state: 'requires_approval',
				terminal: false,
				requires_human: true,
				guidance:
					'Success: the publish was accepted and now awaits one human approval in the Postdom dashboard. This is the designed flow on review-mode accounts, not an error. Keep the post ID and watch it with the Postdom Trigger (Post Status) or poll Post -> Get; reviewer feedback arrives in approval_feedback.',
			};
		case 'changes_requested':
			return {
				state: 'changes_requested',
				terminal: false,
				requires_human: false,
				guidance:
					'The human reviewer asked for changes. Read approval_feedback, revise the caption or media, and publish again (optionally under the same plan).',
			};
		case 'draft':
			return {
				state: 'draft',
				terminal: false,
				requires_human: true,
				guidance:
					'This account is in L0 Manual autonomy: the publish was stored as a draft and a human must explicitly publish or schedule it from the Postdom dashboard.',
			};
		case 'scheduled':
			return {
				state: 'scheduled',
				terminal: false,
				requires_human: false,
				guidance:
					'Accepted and scheduled inside the account policy. It will flow automatically at scheduled_for (UTC) without further approval.',
			};
		case 'publishing':
			return {
				state: 'publishing',
				terminal: false,
				requires_human: false,
				guidance: 'Accepted and publishing now inside the account policy.',
			};
		case 'published':
			return {
				state: 'published',
				terminal: true,
				requires_human: false,
				guidance:
					'Every destination published. Measure it with Post -> Get Performance; metric availability states are passed through honestly.',
			};
		case 'partial':
			return {
				state: 'partial',
				terminal: true,
				requires_human: false,
				guidance:
					'Some destinations published and some failed. Inspect the per-destination publishes array for error_code and error_detail.',
			};
		case 'failed':
			return {
				state: 'failed',
				terminal: true,
				requires_human: false,
				guidance:
					'No destination published. Inspect the publishes array for error_code and error_detail before retrying with a fresh idempotency key.',
			};
		case 'rejected':
			return {
				state: 'rejected',
				terminal: true,
				requires_human: false,
				guidance:
					'The human reviewer rejected this publish. Read approval_feedback before proposing different content.',
			};
		case 'missed_approval':
			return {
				state: 'missed_approval',
				terminal: true,
				requires_human: false,
				guidance:
					'The approval window lapsed before a human reviewed it, so the post will not publish. Resubmit when a reviewer is available.',
			};
		case 'missed_schedule':
			return {
				state: 'missed_schedule',
				terminal: true,
				requires_human: false,
				guidance:
					'Approval arrived after the scheduled time had passed, so the post will not publish. Resubmit with a new schedule.',
			};
		default:
			return {
				state: typeof status === 'string' ? status : 'unknown',
				terminal: false,
				requires_human: false,
				guidance: 'Unrecognized post status; treat it as in-flight and keep polling Post -> Get.',
			};
	}
}

/**
 * Approval-aware read of a plan status. requires_approval is the expected
 * success state right after Submit Plan: one human approves once, then every
 * publish claiming the plan flows without per-post review inside its bounds.
 */
export function planOutcome(status: unknown): PostdomOutcome {
	switch (status) {
		case 'requires_approval':
			return {
				state: 'requires_approval',
				terminal: false,
				requires_human: true,
				guidance:
					'Success: the plan was accepted and now awaits one human approval in the Postdom dashboard. This is the designed plan-first flow, not an error. Poll Plan -> Get; once status is approved, publish with this plan ID and posts flow inside the plan bounds without per-post review.',
			};
		case 'approved':
			return {
				state: 'approved',
				terminal: true,
				requires_human: false,
				guidance:
					'The plan is approved. Publish with this plan ID inside its window and post budget; those publishes flow without per-post review.',
			};
		case 'changes_requested':
			return {
				state: 'changes_requested',
				terminal: false,
				requires_human: false,
				guidance:
					'The human reviewer asked for changes. Read the structured feedback on the plan and submit a revised plan.',
			};
		case 'rejected':
			return {
				state: 'rejected',
				terminal: true,
				requires_human: false,
				guidance: 'The human reviewer rejected the plan. Read the feedback before proposing another.',
			};
		case 'expired':
			return {
				state: 'expired',
				terminal: true,
				requires_human: false,
				guidance: 'The plan window ended. Submit a new plan for the next window.',
			};
		case 'cancelled':
			return {
				state: 'cancelled',
				terminal: true,
				requires_human: false,
				guidance: 'A human cancelled the plan. Publishes can no longer claim it.',
			};
		default:
			return {
				state: typeof status === 'string' ? status : 'unknown',
				terminal: false,
				requires_human: false,
				guidance: 'Unrecognized plan status; keep polling Plan -> Get.',
			};
	}
}

/**
 * Platform target defaults, ported verbatim from PostdomClient.
 * Every publish is private-by-default and AI-disclosed.
 */
export function defaultTarget(
	platform: string,
	accountId: string,
	caption: string,
): Record<string, unknown> {
	if (platform === 'tiktok') {
		return {
			account_id: accountId,
			platform,
			settings: {
				privacy_level: 'SELF_ONLY',
				allow_comment: false,
				allow_duet: false,
				allow_stitch: false,
				content_preview_confirmed: true,
				express_consent_given: true,
				video_made_with_ai: true,
			},
		};
	}
	if (platform === 'instagram') {
		return {
			account_id: accountId,
			platform,
			settings: { contentType: 'reel', isAiGenerated: true },
		};
	}
	if (platform === 'youtube') {
		return {
			account_id: accountId,
			platform,
			settings: {
				title: caption.split('\n')[0]?.slice(0, 100) || 'Postdom video',
				visibility: 'private',
				madeForKids: false,
				containsSyntheticMedia: true,
			},
		};
	}
	throw new Error(`Publishing to ${platform} is not supported yet`);
}
