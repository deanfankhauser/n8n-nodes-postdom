import { randomUUID } from 'crypto';
import type { INode } from 'n8n-workflow';
import { NodeOperationError, sleep as n8nSleep } from 'n8n-workflow';

/**
 * Pure request builders for the Postdom REST API.
 *
 * These mirror the request shapes produced by PostdomClient in the official
 * @postdom/mcp package (packages/mcp/src/index.ts in the postdom repository):
 * same paths, same JSON body keys, same platform target defaults. Keeping the
 * builders free of I/O lets unit tests assert the exact REST shapes; the only
 * n8n helper used here is its verification-safe sleep implementation.
 */

export const DEFAULT_BASE_URL = 'https://api.postdom.com';

export const SOURCE_HEADER = 'X-Postdom-Source';
export const SOURCE_VALUE = 'n8n';

// This package ships standalone and cannot import @postdom/core, so the list is
// restated here. The cap below is derived from it rather than written out a
// second time: a hardcoded 5 was correct until LinkedIn landed and would have
// silently rejected a valid sixth destination.
export const POSTDOM_PLATFORMS = [
	'tiktok',
	'instagram',
	'youtube',
	'facebook',
	'twitter',
	'linkedin',
	'bluesky',
	'snapchat',
	'threads',
] as const;

export type PostdomPlatform = (typeof POSTDOM_PLATFORMS)[number];

export const POSTDOM_PLATFORM_COUNT = POSTDOM_PLATFORMS.length;

/** Offered, not accepted. Mirrors `CONNECT_DESTINATIONS` in `@postdom/core`, which this package
 * cannot import because it ships standalone to n8n.
 *
 * `POSTDOM_PLATFORMS` above is the wire contract - what the API will accept. This is what a
 * customer can actually create an account for. Offering a destination with no Connect path
 * offers a guaranteed failure: the workflow builds, the platform is picked, and no account can
 * exist. The union may be wider than the menu; the menu may not be wider than reality.
 *
 * Written out once here and derived at both pickers, because it was previously written out
 * twice in `Postdom.node.ts` and both copies were four destinations stale. */
export const CONNECT_DESTINATIONS = [
	'instagram',
	'tiktok',
	'youtube',
	'linkedin',
	'facebook',
	'snapchat',
	'twitter',
	'threads',
	'bluesky',
] as const satisfies readonly PostdomPlatform[];

/** The offered destinations that authorise with a credential rather than a redirect.
 *
 * Bluesky uses an app password and has no authorization URL at all, so `connectStart` cannot
 * carry it. A picker that offers it on a connect-by-redirect operation ships a control that
 * cannot succeed, and the error a customer sees names our supplier. Mirrors
 * `CREDENTIAL_DESTINATIONS` in core; see BUILD-25. */
export const CREDENTIAL_DESTINATIONS = ['bluesky'] as const satisfies readonly PostdomPlatform[];

/** The complement, and the only list a connect-by-redirect picker may offer. */
export const REDIRECT_DESTINATIONS = CONNECT_DESTINATIONS
	.filter((destination) => !(CREDENTIAL_DESTINATIONS as readonly string[]).includes(destination));

const DESTINATION_LABELS: Record<PostdomPlatform, string> = {
	tiktok: 'TikTok',
	instagram: 'Instagram',
	youtube: 'YouTube',
	facebook: 'Facebook',
	twitter: 'X',
	linkedin: 'LinkedIn',
	bluesky: 'Bluesky',
	snapchat: 'Snapchat',
	threads: 'Threads',
};

/** n8n option objects for a destination list, so a picker states which list it offers rather
 * than restating its members. */
export function destinationOptions(
	destinations: readonly PostdomPlatform[],
): Array<{ name: string; value: PostdomPlatform }> {
	return destinations.map((destination) => ({ name: DESTINATION_LABELS[destination], value: destination }));
}

export const MEDIA_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const;
export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

/** Still images an upload may declare: core's `platformLimits.global.image_mime_types`, which are
 * also exactly the types a slideshow slide takes (apps/api `slideImageRefusal`). */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

/** Every type a media status read may report: a video or an image upload. */
export const MEDIA_STATUS_CONTENT_TYPES = [...MEDIA_CONTENT_TYPES, ...IMAGE_CONTENT_TYPES] as const;
export type MediaStatusContentType = (typeof MEDIA_STATUS_CONTENT_TYPES)[number];

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
	content_type: MediaStatusContentType;
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
	widthPixels: number;
	heightPixels: number;
	durationSeconds: number;
	idempotencyKey?: string;
}

export interface PostdomNodeErrorContext {
	node: INode;
	itemIndex?: number;
}

export function buildCreateMediaUpload(
	baseUrl: string,
	input: CreateMediaUploadInput,
	errorContext: PostdomNodeErrorContext,
): PostdomRequest {
	if (!(MEDIA_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
		throw new Error('Media content type must be video/mp4 or video/quicktime');
	}
	if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MEDIA_MAX_BYTES) {
		throw new Error(`Media size must be between 1 and ${MEDIA_MAX_BYTES} bytes`);
	}
	if (input.platforms.length < 1 || input.platforms.length > POSTDOM_PLATFORM_COUNT) {
		throw new Error(`Choose between one and ${POSTDOM_PLATFORM_COUNT} target platforms`);
	}
	if (new Set(input.platforms).size !== input.platforms.length) {
		throw new Error('Target platforms must be unique');
	}
	for (const [label, value] of Object.entries({
		width: input.widthPixels,
		height: input.heightPixels,
		duration: input.durationSeconds,
	})) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new NodeOperationError(
				errorContext.node,
				`Video ${label} must be a positive integer from the actual video metadata`,
				{ itemIndex: errorContext.itemIndex },
			);
		}
	}
	return {
		method: 'POST',
		url: `${baseUrl}/v1/media/uploads`,
		headers: writeHeaders(input.idempotencyKey),
		body: {
			content_type: input.contentType,
			size_bytes: input.sizeBytes,
			platforms: input.platforms,
			width_pixels: input.widthPixels,
			height_pixels: input.heightPixels,
			duration_seconds: input.durationSeconds,
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
	expectedContentType: MediaStatusContentType,
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
		!MEDIA_STATUS_CONTENT_TYPES.includes(value.content_type as MediaStatusContentType) ||
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
	const sleep = options.sleep ?? n8nSleep;
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

export interface WaitForSlideshowOptions {
	timeoutMs: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	now?: () => number;
	sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Polls a slideshow until it leaves `rendering` or the timeout passes, with the same bounded
 * backoff media storage uses. A timeout returns the rendering read honestly; nothing is invented.
 */
export async function waitForSlideshow(
	readSlideshow: () => Promise<Record<string, unknown>>,
	first: Record<string, unknown>,
	options: WaitForSlideshowOptions,
): Promise<Record<string, unknown>> {
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? n8nSleep;
	const startedAt = now();
	let delayMs = options.initialDelayMs ?? 2_000;
	const maxDelayMs = options.maxDelayMs ?? 10_000;
	let slideshow = first;
	while (slideshow.status === 'rendering') {
		const remainingMs = options.timeoutMs - (now() - startedAt);
		if (remainingMs <= 0) return slideshow;
		await sleep(Math.min(delayMs, remainingMs));
		slideshow = await readSlideshow();
		delayMs = Math.min(delayMs * 2, maxDelayMs);
	}
	return slideshow;
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

/**
 * The per-destination choices a publish may make, shared by Publish Video and Publish Slideshow.
 * Every one is optional, and an omitted one sends exactly what 0.5.0 sent before it existed, so a
 * workflow that sets none of them builds the same request.
 */
export interface TargetOptions {
	/** BUILD-482. TikTok audience; absent means PUBLIC_TO_EVERYONE (SELF_ONLY before 0.5.0). */
	tiktokPrivacy?: string;
	/** TikTok `allow_comment`, the only comment control on the wire; absent means off. */
	allowComments?: boolean;
	/** The platform AI label (TikTok, Instagram, YouTube); absent means on (Dean, 5 Oct 2026). */
	aiLabel?: boolean;
	/** BUILD-447. TikTok's commercial content disclosure; absent sends none. */
	tiktokCommercialContent?: string;
	/** Photo posts only: TikTok adds one of its recommended tracks. Absent sends none. */
	tiktokAutoAddMusic?: boolean;
	/** YouTube visibility; absent means private, the documented agent default. */
	youtubeVisibility?: string;
	/** YouTube title; absent means the caption's first line. */
	youtubeTitle?: string;
	/** BUILD-528. LinkedIn document (carousel) title. */
	linkedinDocumentTitle?: string;
	/** BUILD-322. Where the post lands, for a destination with more than one place. */
	surface?: string;
}

export interface PublishVideoInput extends TargetOptions {
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

/** BUILD-482. TikTok's four audiences, as the REST target schema names them. */
export const TIKTOK_PRIVACY_LEVELS = [
	'PUBLIC_TO_EVERYONE',
	'MUTUAL_FOLLOW_FRIENDS',
	'FOLLOWER_OF_CREATOR',
	'SELF_ONLY',
] as const;

/** BUILD-447. TikTok's commercial content disclosure, as `tiktokSettingsSchema` names it. */
export const TIKTOK_COMMERCIAL_CONTENT_TYPES = ['none', 'brand_organic', 'brand_content'] as const;

/** `youtubeSettingsSchema.visibility`. */
export const YOUTUBE_VISIBILITIES = ['public', 'private', 'unlisted'] as const;

/** core `LINKEDIN_DOCUMENT_TITLE_MAX`. */
export const LINKEDIN_DOCUMENT_TITLE_MAX = 200;

/** core `platformLimits.youtube.title_max_chars`. */
export const YOUTUBE_TITLE_MAX = 100;

function videoTargetOptions(input: PublishVideoInput): TargetOptions {
	return {
		tiktokPrivacy: input.tiktokPrivacy,
		allowComments: input.allowComments,
		aiLabel: input.aiLabel,
		tiktokCommercialContent: input.tiktokCommercialContent,
		youtubeVisibility: input.youtubeVisibility,
		youtubeTitle: input.youtubeTitle,
	};
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
		return defaultTarget(account.platform, accountId, input.caption, videoTargetOptions(input));
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

// ---------------------------------------------------------------------------
// Slideshows (BUILD-371): POST /v1/slideshows, GET /v1/slideshows/{id}, and the
// multi-image post that publishes one.
// ---------------------------------------------------------------------------

/**
 * Destinations whose provider code posts several images as one carousel. Mirrors core
 * `CAROUSEL_VERIFIED_DESTINATIONS`, which this package cannot import. LinkedIn's carousel is a
 * document post (BUILD-528). YouTube takes no images at all.
 */
export const SLIDESHOW_DESTINATIONS = ['tiktok', 'instagram', 'facebook', 'linkedin'] as const satisfies readonly PostdomPlatform[];

/** core `destinationImageLimits[platform].image_max_items` for the slideshow destinations. */
export const SLIDESHOW_IMAGE_MAX: Record<(typeof SLIDESHOW_DESTINATIONS)[number], number> = {
	tiktok: 35,
	instagram: 10,
	facebook: 10,
	linkedin: 20,
};

/** core `SLIDESHOW_SIZES`. 3:4 is TikTok's photo-post frame; 4:5 suits Instagram and LinkedIn. */
export const SLIDESHOW_SIZES = ['4:5', '3:4', '9:16', '1:1'] as const;
export type SlideshowSize = (typeof SLIDESHOW_SIZES)[number];

/** core `SLIDESHOW_TEMPLATES`. */
export const SLIDESHOW_TEMPLATES = [
	'cover',
	'text_image',
	'list',
	'quote',
	'end_card',
	'stat',
	'compare',
	'checklist',
	'myth_fact',
	'step',
	'cover_image',
] as const;

/** core `SLIDESHOW_MAX_SLIDES`. */
export const SLIDESHOW_MAX_SLIDES = 20;

/**
 * core `SLIDESHOW_FIELD_LIMITS`: the most characters each field holds so the copy fits at every
 * size. The simple slide builder below clips to these; the API answers anything longer with a
 * structured refusal naming the slide and field.
 */
export const SLIDESHOW_FIELD_LIMITS = {
	cover: { headline: 80, kicker: 32 },
	cover_image: { headline: 90, kicker: 32, body: 70 },
	list: { items: 44, title: 48 },
	step: { headline: 60, body: 180 },
	end_card: { cta: 60, handle: 28 },
} as const;

const SLIDESHOW_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plain text, one line, cut at a word to `max` characters with an ellipsis. */
export function clipSlideText(value: unknown, max: number): string {
	const text = String(value ?? '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
	if (text.length <= max) return text;
	const cut = text.slice(0, max - 1);
	const space = cut.lastIndexOf(' ');
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:-]+$/, '')}…`;
}

export interface SimpleSlidesInput {
	title: string;
	kicker?: string;
	coverImageHandle?: string;
	/** One point per line (or an array), up to five. */
	points?: string | string[];
	pointsStyle?: 'list' | 'steps';
	pointsTitle?: string;
	cta?: string;
	handle?: string;
}

/**
 * Slides from plain fields: a cover (with a photo when one is given), the points as one list
 * slide or one slide per step, and an end card. Same shape as the Zapier and Make actions build.
 */
export function buildSimpleSlides(input: SimpleSlidesInput): Array<Record<string, unknown>> {
	const title = input.title?.trim();
	if (!title) throw new Error('Title is required unless the slides are given as JSON');
	const L = SLIDESHOW_FIELD_LIMITS;
	const kicker = input.kicker?.trim();
	const cover = input.coverImageHandle?.trim();
	if (cover) assertMediaHandle(cover);
	const slides: Array<Record<string, unknown>> = [
		cover
			? {
					template: 'cover_image',
					headline: clipSlideText(title, L.cover_image.headline),
					image_media_id: cover,
					...(kicker ? { kicker: clipSlideText(kicker, L.cover_image.kicker) } : {}),
				}
			: {
					template: 'cover',
					headline: clipSlideText(title, L.cover.headline),
					...(kicker ? { kicker: clipSlideText(kicker, L.cover.kicker) } : {}),
				},
	];
	const points = (Array.isArray(input.points) ? input.points : String(input.points ?? '').split(/\n+/))
		.map((point) => String(point).replace(/^[-*•\d.)\s]+/, '').trim())
		.filter(Boolean)
		.slice(0, 5);
	if (input.pointsStyle === 'steps') {
		points.slice(0, 4).forEach((point, index) => {
			const [head, ...rest] = point.split(/(?<=[.!?:])\s+/);
			slides.push({
				template: 'step',
				step: index + 1,
				headline: clipSlideText(head, L.step.headline),
				...(rest.length ? { body: clipSlideText(rest.join(' '), L.step.body) } : {}),
			});
		});
	} else if (points.length > 0) {
		const listTitle = input.pointsTitle?.trim();
		slides.push({
			template: 'list',
			...(listTitle ? { title: clipSlideText(listTitle, L.list.title) } : {}),
			items: points.map((point) => clipSlideText(point, L.list.items)),
		});
	}
	const handle = input.handle?.trim();
	slides.push({
		template: 'end_card',
		cta: clipSlideText(input.cta?.trim() || 'Follow for more', L.end_card.cta),
		...(handle ? { handle: clipSlideText(handle, L.end_card.handle) } : {}),
	});
	return slides;
}

/** Slides given as JSON text or an array (for example `{{ $json.slides }}` from a Code node). */
export function parseSlides(value: unknown): Array<Record<string, unknown>> {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new Error('Slides (JSON) must be a JSON array of slides');
		}
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error('Slides (JSON) must be a non-empty array of slides');
	}
	if (parsed.length > SLIDESHOW_MAX_SLIDES) {
		throw new Error(`A slideshow takes at most ${SLIDESHOW_MAX_SLIDES} slides`);
	}
	parsed.forEach((slide, index) => {
		if (typeof slide !== 'object' || slide === null || Array.isArray(slide)) {
			throw new Error(`Slide ${index + 1} must be an object`);
		}
		const template = (slide as Record<string, unknown>).template;
		const bare = typeof template === 'string' ? template.replace(/@[0-9]{1,4}$/, '') : '';
		if (!(SLIDESHOW_TEMPLATES as readonly string[]).includes(bare)) {
			throw new Error(`Slide ${index + 1} template must be one of ${SLIDESHOW_TEMPLATES.join(', ')}`);
		}
	});
	return parsed as Array<Record<string, unknown>>;
}

export interface CreateSlideshowInput {
	size: string;
	slides: Array<Record<string, unknown>>;
	design?: string;
	idempotencyKey?: string;
	/** Seconds the API may hold the request open while it renders (RFC 7240 `Prefer: wait`). */
	waitSeconds?: number;
}

/** The longest a create waits server-side; the API caps it at 25 s (`SLIDESHOW_WAIT_MS`). */
export const SLIDESHOW_PREFER_WAIT_SECONDS = 25;

export function buildCreateSlideshow(baseUrl: string, input: CreateSlideshowInput): PostdomRequest {
	if (!(SLIDESHOW_SIZES as readonly string[]).includes(input.size)) {
		throw new Error(`Slide Size must be one of ${SLIDESHOW_SIZES.join(', ')}`);
	}
	const slides = parseSlides(input.slides);
	const body: Record<string, unknown> = { size: input.size, slides };
	const design = input.design?.trim();
	if (design) body.design = design;
	const wait = Math.max(1, Math.min(SLIDESHOW_PREFER_WAIT_SECONDS, Math.round(input.waitSeconds ?? SLIDESHOW_PREFER_WAIT_SECONDS)));
	return {
		method: 'POST',
		url: `${baseUrl}/v1/slideshows`,
		headers: { ...writeHeaders(input.idempotencyKey), Prefer: `wait=${wait}` },
		body,
		json: true,
	};
}

export function buildGetSlideshow(baseUrl: string, slideshowId: string): PostdomRequest {
	const id = slideshowId.trim();
	if (!SLIDESHOW_ID_PATTERN.test(id)) throw new Error('Slideshow ID must be the UUID returned by Create Slideshow');
	return get(baseUrl, `/v1/slideshows/${encodeURIComponent(id)}`);
}

export const SLIDESHOW_STATUSES = ['rendering', 'ready', 'refused', 'failed'] as const;

/**
 * A slideshow read with its slides' media handles in carousel order, ready to map into
 * Publish Slideshow. Everything the API returned is kept.
 */
export function withSlideshowHandles(response: Record<string, unknown>): Record<string, unknown> {
	const media = Array.isArray(response.media) ? (response.media as Array<Record<string, unknown>>) : [];
	const ordered = [...media].sort((a, b) => Number(a.position) - Number(b.position));
	return {
		...response,
		media_handles: ordered.map((item) => item.media_id).filter((id): id is string => typeof id === 'string'),
		slide_count: ordered.length,
	};
}

/** One readable sentence from the API's `slides_do_not_fit` refusals. */
export function slideshowRefusalMessage(problem: Record<string, unknown>): string {
	const refusals = Array.isArray(problem.refusals) ? (problem.refusals as Array<Record<string, unknown>>) : [];
	if (refusals.length === 0) return String(problem.detail ?? 'The slides could not be rendered');
	return `Some slide text does not fit: ${refusals
		.map((refusal) => `slide ${refusal.slide ?? '?'} ${refusal.field}: ${refusal.reason}`)
		.join('; ')}`;
}

export interface PublishSlideshowInput {
	accountIds: string[];
	mediaHandles: string[];
	caption: string;
	intent: string;
	agentIdentity?: string;
	publishAt?: string;
	planId?: string;
	idempotencyKey?: string;
	tiktokPrivacy?: string;
	allowComments?: boolean;
	aiLabel?: boolean;
	tiktokCommercialContent?: string;
	/** Absent means on: a photo post with TikTok's own recommended music, as the app posts one. */
	tiktokAutoAddMusic?: boolean;
	/** Absent means the caption's first line. */
	linkedinDocumentTitle?: string;
}

/** Media handles as a list, from an array or comma/newline separated text. */
export function splitMediaHandles(value: unknown): string[] {
	const raw = Array.isArray(value) ? value.map(String) : String(value ?? '').split(/[\s,]+/);
	return raw.map((handle) => handle.trim()).filter((handle) => handle !== '');
}

/**
 * A multi-image post (POST /v1/posts with `media[]`) from a rendered slideshow, to the carousel
 * destinations only. Targets match the app's own slideshow publish (apps/api `draftTargets`):
 * Instagram and Facebook to the feed, TikTok as a photo post with TikTok's recommended music, and
 * LinkedIn as a document post with a title.
 */
export function buildPublishSlideshow(
	baseUrl: string,
	input: PublishSlideshowInput,
	accounts: PostdomAccount[],
): PostdomRequest {
	const handles = input.mediaHandles;
	if (handles.length === 0) throw new Error('Media Handles is empty. Map media_handles from Create Slideshow.');
	for (const handle of handles) assertMediaHandle(handle);
	const byId = new Map(accounts.map((account) => [account.providerAccountId, account]));
	const linkedinTitle = input.linkedinDocumentTitle?.trim() || input.caption.split('\n')[0] || '';
	const targets = input.accountIds.map((accountId) => {
		const account = byId.get(accountId);
		if (!account) throw new Error(`Postdom account ${accountId} is not connected`);
		const platform = account.platform as (typeof SLIDESHOW_DESTINATIONS)[number];
		if (!(SLIDESHOW_DESTINATIONS as readonly string[]).includes(platform)) {
			throw new Error(
				`Slideshows post to TikTok, Instagram, Facebook and LinkedIn; account ${accountId} is ${account.platform}`,
			);
		}
		if (handles.length > SLIDESHOW_IMAGE_MAX[platform]) {
			throw new Error(
				`${DESTINATION_LABELS[platform]} takes at most ${SLIDESHOW_IMAGE_MAX[platform]} images in one post; this slideshow has ${handles.length}`,
			);
		}
		return defaultTarget(platform, accountId, input.caption, {
			tiktokPrivacy: input.tiktokPrivacy,
			allowComments: input.allowComments,
			aiLabel: input.aiLabel,
			tiktokCommercialContent: input.tiktokCommercialContent,
			tiktokAutoAddMusic: platform === 'tiktok' ? (input.tiktokAutoAddMusic ?? true) : undefined,
			// A single image goes as LinkedIn's own image post: no document, no title (BUILD-538).
			linkedinDocumentTitle: platform === 'linkedin' && handles.length > 1 ? linkedinTitle : undefined,
			surface: platform === 'instagram' || platform === 'facebook' ? 'feed' : undefined,
		});
	});
	const body: Record<string, unknown> = {
		caption: input.caption,
		media: handles.map((handle) => ({ media_handle: handle })),
		targets,
		agent_context: {
			identity: agentIdentity(input.agentIdentity),
			intent: input.intent,
		},
	};
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

// ---------------------------------------------------------------------------
// Images (BUILD-314): an image upload declares its type, bytes and pixel size, and no duration.
// ---------------------------------------------------------------------------

export interface ImageInfo {
	contentType: ImageContentType;
	width: number;
	height: number;
}

/** The real type and pixel size of a PNG, JPEG, GIF or WebP, read from its bytes; null otherwise. */
export function readImageInfo(bytes: Buffer): ImageInfo | null {
	if (bytes.length >= 24 && bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG') {
		return { contentType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	}
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let p = 2;
		while (p + 9 < bytes.length) {
			if (bytes[p] !== 0xff) {
				p += 1;
				continue;
			}
			const marker = bytes.readUInt8(p + 1);
			if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
				return { contentType: 'image/jpeg', height: bytes.readUInt16BE(p + 5), width: bytes.readUInt16BE(p + 7) };
			}
			p += 2 + bytes.readUInt16BE(p + 2);
		}
		return null;
	}
	if (bytes.length >= 10 && bytes.toString('latin1', 0, 4) === 'GIF8') {
		return { contentType: 'image/gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
	}
	if (bytes.length >= 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
		const chunk = bytes.toString('latin1', 12, 16);
		if (chunk === 'VP8X') {
			return { contentType: 'image/webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
		}
		if (chunk === 'VP8L' && bytes[20] === 0x2f) {
			const bits = bytes.readUInt32LE(21);
			return { contentType: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
		}
		if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
			return { contentType: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
		}
	}
	return null;
}

export interface CreateImageUploadInput {
	contentType: ImageContentType;
	sizeBytes: number;
	widthPixels: number;
	heightPixels: number;
	/** Optional: omitted, the image is checked against the global limits only (BUILD-290). */
	platforms?: PostdomPlatform[];
	idempotencyKey?: string;
}

export function buildCreateImageUpload(baseUrl: string, input: CreateImageUploadInput): PostdomRequest {
	if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
		throw new Error(`Images must be ${IMAGE_CONTENT_TYPES.join(', ')}`);
	}
	if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MEDIA_MAX_BYTES) {
		throw new Error(`Media size must be between 1 and ${MEDIA_MAX_BYTES} bytes`);
	}
	for (const [label, value] of Object.entries({ width: input.widthPixels, height: input.heightPixels })) {
		if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Image ${label} could not be read from the file`);
	}
	const body: Record<string, unknown> = {
		content_type: input.contentType,
		size_bytes: input.sizeBytes,
		width_pixels: input.widthPixels,
		height_pixels: input.heightPixels,
	};
	if (input.platforms && input.platforms.length > 0) {
		if (new Set(input.platforms).size !== input.platforms.length) throw new Error('Target platforms must be unique');
		body.platforms = input.platforms;
	}
	return {
		method: 'POST',
		url: `${baseUrl}/v1/media/uploads`,
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

export interface PostdomN8nGuidance {
	state: string;
	terminal: boolean;
	requires_human: boolean;
	guidance: string;
}

/** Keep server evidence separate from this connector's approval/polling guidance. */
export function withN8nGuidance<T extends Record<string, unknown>>(
	response: T,
	guidance: PostdomN8nGuidance,
	errorContext: PostdomNodeErrorContext,
) {
	if (Object.prototype.hasOwnProperty.call(response, 'postdom_n8n_guidance')) {
		throw new NodeOperationError(
			errorContext.node,
			'API response contains the reserved postdom_n8n_guidance field',
			{ itemIndex: errorContext.itemIndex },
		);
	}
	return { ...response, postdom_n8n_guidance: { ...guidance } };
}

/**
 * Approval-aware read of a post/publish status. A publish that lands in review
 * is a SUCCESS state with guidance, never an error: Postdom is built so agents
 * propose and humans keep approval authority.
 */
export function publishGuidance(status: unknown): PostdomN8nGuidance {
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
export function planGuidance(status: unknown): PostdomN8nGuidance {
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
 * Platform target defaults, ported from PostdomClient, with the per-destination choices in
 * `TargetOptions`. Every publish uses the safety defaults supported by its provider; an option
 * left out sends exactly the default PostdomClient sends.
 *
 * The fourth argument was the TikTok privacy string alone until the options existed, and a string
 * is still read as that.
 */
export function defaultTarget(
	platform: string,
	accountId: string,
	caption: string,
	options: string | TargetOptions = {},
): Record<string, unknown> {
	const choices: TargetOptions = typeof options === 'string' ? { tiktokPrivacy: options } : options;
	const aiLabel = choices.aiLabel ?? true;
	const surface = choices.surface ? { surface: choices.surface } : {};
	if (platform === 'tiktok') {
		const privacy = choices.tiktokPrivacy;
		if (privacy !== undefined && !(TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(privacy)) {
			throw new Error(`TikTok Privacy must be one of ${TIKTOK_PRIVACY_LEVELS.join(', ')}`);
		}
		const commercial = choices.tiktokCommercialContent;
		if (commercial !== undefined && !(TIKTOK_COMMERCIAL_CONTENT_TYPES as readonly string[]).includes(commercial)) {
			throw new Error(`TikTok Commercial Content must be one of ${TIKTOK_COMMERCIAL_CONTENT_TYPES.join(', ')}`);
		}
		// core `tiktokBrandedContentIsPrivate`: TikTok refuses branded content only the creator can see.
		if (commercial === 'brand_content' && privacy === 'SELF_ONLY') {
			throw new Error('TikTok does not allow branded content to be posted as Only Me; choose another TikTok Privacy');
		}
		const settings: Record<string, unknown> = {
			privacy_level: privacy ?? 'PUBLIC_TO_EVERYONE',
			allow_comment: choices.allowComments ?? false,
			allow_duet: false,
			allow_stitch: false,
			content_preview_confirmed: true,
			express_consent_given: true,
			video_made_with_ai: aiLabel,
		};
		if (commercial !== undefined) settings.commercialContentType = commercial;
		if (choices.tiktokAutoAddMusic !== undefined) settings.auto_add_music = choices.tiktokAutoAddMusic;
		return { account_id: accountId, platform, ...surface, settings };
	}
	if (platform === 'instagram') {
		return {
			account_id: accountId,
			platform,
			...surface,
			settings: { contentType: 'reel', isAiGenerated: aiLabel },
		};
	}
	if (platform === 'youtube') {
		const visibility = choices.youtubeVisibility;
		if (visibility !== undefined && !(YOUTUBE_VISIBILITIES as readonly string[]).includes(visibility)) {
			throw new Error(`YouTube Visibility must be one of ${YOUTUBE_VISIBILITIES.join(', ')}`);
		}
		const named = choices.youtubeTitle?.trim();
		return {
			account_id: accountId,
			platform,
			...surface,
			settings: {
				title: named
					? named.slice(0, YOUTUBE_TITLE_MAX)
					: caption.split('\n')[0]?.slice(0, YOUTUBE_TITLE_MAX) || 'Postdom video',
				visibility: visibility ?? 'private',
				madeForKids: false,
				containsSyntheticMedia: aiLabel,
			},
		};
	}
	if (platform === 'facebook') {
		// Facebook exposes no AI-generated flag (core BUILD-432 audit), so the AI label has nothing to set.
		return {
			account_id: accountId,
			platform,
			...surface,
			settings: { contentType: 'reel' },
		};
	}
	if (platform === 'linkedin') {
		const title =
			choices.linkedinDocumentTitle === undefined ? undefined : linkedinDocumentTitle(choices.linkedinDocumentTitle);
		return {
			account_id: accountId,
			platform,
			...surface,
			settings: title ? { documentTitle: title } : {},
		};
	}
	if (platform === 'twitter' || platform === 'bluesky') {
		return { account_id: accountId, platform, ...surface, settings: {} };
	}
	// Accepted, though not offered: Postdom sends no Threads settings and the wire contract takes
	// every core platform. The picker is the narrower list.
	if (platform === 'threads') {
		return { account_id: accountId, platform, ...surface, settings: {} };
	}
	// Accepted, though not offered: snapchatSettingsSchema is empty and the wire contract takes
	// every core platform.
	if (platform === 'snapchat') {
		return { account_id: accountId, platform, ...surface, settings: {} };
	}
	throw new Error(`Publishing to ${platform} is not supported yet`);
}

/** core `linkedinDocumentTitle`: one line, within Postdom's ceiling, or undefined when blank. */
export function linkedinDocumentTitle(value: string): string | undefined {
	const line = value.replace(/\s+/g, ' ').trim();
	if (!line) return undefined;
	if (line.length <= LINKEDIN_DOCUMENT_TITLE_MAX) return line;
	return `${line.slice(0, LINKEDIN_DOCUMENT_TITLE_MAX - 1).trimEnd()}…`;
}
