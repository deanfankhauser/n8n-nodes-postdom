import { describe, expect, it } from 'vitest';

import type { PostdomAccount } from '../nodes/Postdom/PostdomRequests';
import {
	buildConnectAccount,
	buildCreateMediaUpload,
	buildDirectMediaPut,
	buildGetAccountPerformance,
	buildGetBestPosts,
	buildGetBrief,
	buildGetDigest,
	buildGetMediaStatus,
	buildGetPlan,
	buildGetPost,
	buildGetPostPerformance,
	buildGetWorkspaceStatus,
	buildListAccounts,
	buildPublishVideo,
	buildSubmitPlan,
	DEFAULT_BASE_URL,
	isTerminalPostStatus,
	normalizeBaseUrl,
	parseMediaStatus,
	parseMediaUploadContract,
	planOutcome,
	publishOutcome,
	selectTerminalEmissions,
	TERMINAL_POST_STATUSES,
	waitForMediaStorage,
} from '../nodes/Postdom/PostdomRequests';

const BASE = 'https://api.example.test';
const MEDIA_HANDLE = 'pd_media_11111111-1111-4111-8111-111111111111';

const READ_HEADERS = {
	Accept: 'application/json',
	'X-Postdom-Source': 'n8n',
};

const ACCOUNTS: PostdomAccount[] = [
	{ providerAccountId: 'acc_tt', platform: 'tiktok' },
	{ providerAccountId: 'acc_ig', platform: 'instagram' },
	{ providerAccountId: 'acc_yt', platform: 'youtube' },
];

describe('normalizeBaseUrl', () => {
	it('falls back to the hosted default', () => {
		expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_BASE_URL);
		expect(normalizeBaseUrl('  ')).toBe(DEFAULT_BASE_URL);
		expect(DEFAULT_BASE_URL).toBe('https://api-web-production-4094.up.railway.app');
	});

	it('strips trailing slashes', () => {
		expect(normalizeBaseUrl('https://api.example.test/')).toBe('https://api.example.test');
		expect(normalizeBaseUrl('https://api.example.test//')).toBe('https://api.example.test');
	});
});

describe('read requests', () => {
	it('builds GET /v1/workspace/status', () => {
		expect(buildGetWorkspaceStatus(BASE)).toStrictEqual({
			method: 'GET',
			url: `${BASE}/v1/workspace/status`,
			headers: READ_HEADERS,
			json: true,
		});
	});

	it('builds GET /v1/brief and /v1/digest and /v1/accounts', () => {
		expect(buildGetBrief(BASE).url).toBe(`${BASE}/v1/brief`);
		expect(buildGetDigest(BASE).url).toBe(`${BASE}/v1/digest`);
		expect(buildListAccounts(BASE).url).toBe(`${BASE}/v1/accounts`);
		for (const request of [buildGetBrief(BASE), buildGetDigest(BASE), buildListAccounts(BASE)]) {
			expect(request.method).toBe('GET');
			expect(request.headers).toStrictEqual(READ_HEADERS);
			expect(request.body).toBeUndefined();
		}
	});

	it('builds plan and post reads with URI-encoded ids', () => {
		expect(buildGetPlan(BASE, 'plan/1').url).toBe(`${BASE}/v1/plans/plan%2F1`);
		expect(buildGetPost(BASE, 'post 1').url).toBe(`${BASE}/v1/posts/post%201`);
		expect(buildGetPostPerformance(BASE, 'post 1').url).toBe(
			`${BASE}/v1/posts/post%201/performance`,
		);
	});

	it('builds account performance and best-posts queries', () => {
		expect(buildGetAccountPerformance(BASE, 'acc 1', '30d').url).toBe(
			`${BASE}/v1/accounts/acc%201/performance?window=30d`,
		);
		expect(buildGetBestPosts(BASE, 'acc 1', 'watch_time_s', '7d').url).toBe(
			`${BASE}/v1/accounts/acc%201/best-posts?metric=watch_time_s&window=7d`,
		);
	});
});

describe('media upload requests', () => {
	it('builds the authenticated create request from the core media contract', () => {
		expect(
			buildCreateMediaUpload(BASE, {
				contentType: 'video/mp4',
				sizeBytes: 4,
				platforms: ['tiktok', 'instagram'],
				idempotencyKey: 'media-key-1',
			}),
		).toStrictEqual({
			method: 'POST',
			url: `${BASE}/v1/media/uploads`,
			headers: { ...READ_HEADERS, 'Idempotency-Key': 'media-key-1' },
			body: {
				content_type: 'video/mp4',
				size_bytes: 4,
				platforms: ['tiktok', 'instagram'],
			},
			json: true,
		});
	});

	it('builds the encoded status read and rejects invalid handles', () => {
		expect(buildGetMediaStatus(BASE, MEDIA_HANDLE)).toStrictEqual({
			method: 'GET',
			url: `${BASE}/v1/media/${MEDIA_HANDLE}`,
			headers: READ_HEADERS,
			json: true,
		});
		expect(() => buildGetMediaStatus(BASE, 'media-from-someone-else')).toThrowError(
			'valid Postdom media handle',
		);
	});

	it('builds a PUT with only the exact signed headers and byte length', () => {
		const contract = parseMediaUploadContract(
			{
				media_handle: MEDIA_HANDLE,
				upload_url: 'https://r2.example.test/signed-once',
				method: 'PUT',
				headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' },
				expires_at: '2026-08-28T12:05:00.000Z',
			},
			'video/mp4',
			4,
			Date.parse('2026-08-28T12:00:00.000Z'),
		);
		const request = buildDirectMediaPut(contract, Buffer.from([1, 2, 3, 4]));
		expect(request).toStrictEqual({
			method: 'PUT',
			url: 'https://r2.example.test/signed-once',
			headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' },
			body: Buffer.from([1, 2, 3, 4]),
		});
		expect(request.headers).not.toHaveProperty('Authorization');
		expect(request.headers).not.toHaveProperty('X-Postdom-Source');
		expect(JSON.stringify({ media_handle: contract.media_handle, status: 'pending' })).not.toContain(
			contract.upload_url,
		);
	});

	it('rejects mismatched, expired, and oversized upload contracts before PUT', () => {
		const base = {
			media_handle: MEDIA_HANDLE,
			upload_url: 'https://r2.example.test/signed-once',
			method: 'PUT',
			headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' },
			expires_at: '2026-08-28T12:05:00.000Z',
		};
		expect(() =>
			parseMediaUploadContract(base, 'video/mp4', 5, Date.parse('2026-08-28T12:00:00Z')),
		).toThrowError('do not match');
		expect(() =>
			parseMediaUploadContract(base, 'video/mp4', 4, Date.parse('2026-08-28T12:06:00Z')),
		).toThrowError('expired');
		expect(() =>
			buildCreateMediaUpload(BASE, {
				contentType: 'video/mp4',
				sizeBytes: 500 * 1024 * 1024 + 1,
				platforms: ['tiktok'],
			}),
		).toThrowError('Media size');
	});

	it('preserves pending, stored, and failed exactly while polling with bounded backoff', async () => {
		const status = (value: 'pending' | 'stored' | 'failed') =>
			parseMediaStatus({
				media_handle: MEDIA_HANDLE,
				status: value,
				content_type: 'video/mp4',
				size_bytes: 4,
				media_url: value === 'stored' ? 'https://media.example.test/video.mp4' : null,
				failure_reason: value === 'failed' ? 'checksum mismatch' : null,
			});
		let currentTime = 0;
		const sequence = [status('pending'), status('pending'), status('stored')];
		const sleeps: number[] = [];
		const stored = await waitForMediaStorage(async () => sequence.shift()!, {
			timeoutMs: 10_000,
			initialDelayMs: 1_000,
			maxDelayMs: 4_000,
			now: () => currentTime,
			sleep: async (milliseconds) => {
				sleeps.push(milliseconds);
				currentTime += milliseconds;
			},
		});
		expect(stored.status).toBe('stored');
		expect(sleeps).toStrictEqual([1_000, 2_000]);

		const failed = await waitForMediaStorage(async () => status('failed'), { timeoutMs: 1 });
		expect(failed.status).toBe('failed');

		currentTime = 0;
		const pending = await waitForMediaStorage(async () => status('pending'), {
			timeoutMs: 1_000,
			now: () => currentTime,
			sleep: async (milliseconds) => {
				currentTime += milliseconds;
			},
		});
		expect(pending.status).toBe('pending');
	});
});

describe('buildConnectAccount', () => {
	it('builds POST /v1/accounts/connect with the exact body', () => {
		const request = buildConnectAccount(BASE, {
			platform: 'tiktok',
			redirectUrl: 'https://app.postdom.com/accounts',
			idempotencyKey: 'fixed-key',
		});
		expect(request).toStrictEqual({
			method: 'POST',
			url: `${BASE}/v1/accounts/connect`,
			headers: { ...READ_HEADERS, 'Idempotency-Key': 'fixed-key' },
			body: {
				platform: 'tiktok',
				redirect_url: 'https://app.postdom.com/accounts',
			},
			json: true,
		});
	});

	it('auto-generates an idempotency key when none is given', () => {
		const first = buildConnectAccount(BASE, {
			platform: 'youtube',
			redirectUrl: 'https://app.postdom.com/accounts',
		});
		const second = buildConnectAccount(BASE, {
			platform: 'youtube',
			redirectUrl: 'https://app.postdom.com/accounts',
		});
		expect(first.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
		expect(first.headers['Idempotency-Key']).not.toBe(second.headers['Idempotency-Key']);
	});
});

describe('buildSubmitPlan', () => {
	it('builds POST /v1/plans mirroring PostdomClient.submitPlan', () => {
		const request = buildSubmitPlan(
			BASE,
			{
				accountIds: ['acc_tt', 'acc_ig'],
				title: 'Week 36 push',
				objective: 'Grow saves on product explainers',
				startsAt: '2026-09-01T09:00:00Z',
				endsAt: '2026-09-08T09:00:00Z',
				maxPosts: 5,
				briefVersion: 3,
				intent: 'Scheduled weekly plan from n8n',
				agentIdentity: 'Growth workflow',
				idempotencyKey: 'plan-key-1',
			},
			ACCOUNTS,
		);
		expect(request).toStrictEqual({
			method: 'POST',
			url: `${BASE}/v1/plans`,
			headers: { ...READ_HEADERS, 'Idempotency-Key': 'plan-key-1' },
			body: {
				title: 'Week 36 push',
				objective: 'Grow saves on product explainers',
				starts_at: '2026-09-01T09:00:00Z',
				ends_at: '2026-09-08T09:00:00Z',
				max_posts: 5,
				brief_version: 3,
				targets: [
					{ account_id: 'acc_tt', platform: 'tiktok' },
					{ account_id: 'acc_ig', platform: 'instagram' },
				],
				agent_context: {
					identity: 'Growth workflow',
					intent: 'Scheduled weekly plan from n8n',
				},
			},
			json: true,
		});
	});

	it('omits brief_version when absent and defaults the agent identity', () => {
		const request = buildSubmitPlan(
			BASE,
			{
				accountIds: ['acc_tt'],
				title: 'T',
				objective: 'O',
				startsAt: '2026-09-01T09:00:00Z',
				endsAt: '2026-09-02T09:00:00Z',
				maxPosts: 1,
				intent: 'I',
				idempotencyKey: 'plan-key-2',
			},
			ACCOUNTS,
		);
		expect(request.body).not.toHaveProperty('brief_version');
		expect((request.body as { agent_context: { identity: string } }).agent_context.identity).toBe(
			'AI agent via n8n',
		);
	});

	it('rejects account ids that are not connected', () => {
		expect(() =>
			buildSubmitPlan(
				BASE,
				{
					accountIds: ['acc_missing'],
					title: 'T',
					objective: 'O',
					startsAt: '2026-09-01T09:00:00Z',
					endsAt: '2026-09-02T09:00:00Z',
					maxPosts: 1,
					intent: 'I',
				},
				ACCOUNTS,
			),
		).toThrowError('Postdom account acc_missing is not connected');
	});
});

describe('buildPublishVideo', () => {
	it('builds POST /v1/posts mirroring PostdomClient.publishVideo, including platform target defaults', () => {
		const request = buildPublishVideo(
			BASE,
			{
				accountIds: ['acc_tt', 'acc_ig', 'acc_yt'],
				videoUrl: 'https://cdn.example.test/video.mp4',
				caption: 'First line title\nSecond line detail',
				intent: 'Publish weekly explainer',
				publishAt: '2026-09-01T10:00:00Z',
				planId: '3e4c8a4e-2f4b-4b6e-9a44-3a1a1c2d3e4f',
				idempotencyKey: 'post-key-1',
			},
			ACCOUNTS,
		);
		expect(request).toStrictEqual({
			method: 'POST',
			url: `${BASE}/v1/posts`,
			headers: { ...READ_HEADERS, 'Idempotency-Key': 'post-key-1' },
			body: {
				caption: 'First line title\nSecond line detail',
				media_url: 'https://cdn.example.test/video.mp4',
				publish_at: '2026-09-01T10:00:00Z',
				plan_id: '3e4c8a4e-2f4b-4b6e-9a44-3a1a1c2d3e4f',
				targets: [
					{
						account_id: 'acc_tt',
						platform: 'tiktok',
						settings: {
							privacy_level: 'SELF_ONLY',
							allow_comment: false,
							allow_duet: false,
							allow_stitch: false,
							content_preview_confirmed: true,
							express_consent_given: true,
							video_made_with_ai: true,
						},
					},
					{
						account_id: 'acc_ig',
						platform: 'instagram',
						settings: { contentType: 'reel', isAiGenerated: true },
					},
					{
						account_id: 'acc_yt',
						platform: 'youtube',
						settings: {
							title: 'First line title',
							visibility: 'private',
							madeForKids: false,
							containsSyntheticMedia: true,
						},
					},
				],
				agent_context: {
					identity: 'AI agent via n8n',
					intent: 'Publish weekly explainer',
				},
			},
			json: true,
		});
	});

	it('omits publish_at and plan_id when absent', () => {
		const request = buildPublishVideo(
			BASE,
			{
				accountIds: ['acc_ig'],
				videoUrl: 'https://cdn.example.test/video.mp4',
				caption: 'Caption',
				intent: 'I',
				idempotencyKey: 'post-key-2',
			},
			ACCOUNTS,
		);
		expect(request.body).not.toHaveProperty('publish_at');
		expect(request.body).not.toHaveProperty('plan_id');
	});

	it('publishes by media handle without retaining a video URL', () => {
		const request = buildPublishVideo(
			BASE,
			{
				accountIds: ['acc_ig'],
				mediaHandle: MEDIA_HANDLE,
				caption: 'Caption',
				intent: 'I',
				idempotencyKey: 'post-key-handle',
			},
			ACCOUNTS,
		);
		expect(request.body).toHaveProperty('media_handle', MEDIA_HANDLE);
		expect(request.body).not.toHaveProperty('media_url');
	});

	it('requires exactly one URL or handle and preserves the legacy URL field', () => {
		const common = {
			accountIds: ['acc_ig'],
			caption: 'Caption',
			intent: 'I',
		};
		expect(() => buildPublishVideo(BASE, common, ACCOUNTS)).toThrowError('exactly one');
		expect(() =>
			buildPublishVideo(
				BASE,
				{
					...common,
					videoUrl: 'https://cdn.example.test/video.mp4',
					mediaHandle: MEDIA_HANDLE,
				},
				ACCOUNTS,
			),
		).toThrowError('exactly one');
		const legacy = buildPublishVideo(
			BASE,
			{ ...common, videoUrl: 'https://cdn.example.test/video.mp4' },
			ACCOUNTS,
		);
		expect(legacy.body).toHaveProperty('media_url', 'https://cdn.example.test/video.mp4');
		expect(legacy.body).not.toHaveProperty('media_handle');
	});

	it('truncates the derived YouTube title to 100 characters and falls back when the caption is empty', () => {
		const longFirstLine = 'x'.repeat(150);
		const longCaption = buildPublishVideo(
			BASE,
			{
				accountIds: ['acc_yt'],
				videoUrl: 'https://cdn.example.test/video.mp4',
				caption: `${longFirstLine}\nrest`,
				intent: 'I',
				idempotencyKey: 'k',
			},
			ACCOUNTS,
		);
		const emptyCaption = buildPublishVideo(
			BASE,
			{
				accountIds: ['acc_yt'],
				videoUrl: 'https://cdn.example.test/video.mp4',
				caption: '',
				intent: 'I',
				idempotencyKey: 'k',
			},
			ACCOUNTS,
		);
		const titleOf = (request: { body?: Record<string, unknown> }): string => {
			const targets = request.body?.targets as Array<{ settings: { title: string } }>;
			return targets[0]!.settings.title;
		};
		expect(titleOf(longCaption)).toBe('x'.repeat(100));
		expect(titleOf(emptyCaption)).toBe('Postdom video');
	});

	it('rejects platforms without publish support', () => {
		expect(() =>
			buildPublishVideo(
				BASE,
				{
					accountIds: ['acc_x'],
					videoUrl: 'https://cdn.example.test/video.mp4',
					caption: 'Caption',
					intent: 'I',
				},
				[{ providerAccountId: 'acc_x', platform: 'linkedin' }],
			),
		).toThrowError('Publishing to linkedin is not supported yet');
	});
});

describe('terminal post statuses', () => {
	it('matches the post_status enum minus the in-flight states', () => {
		expect([...TERMINAL_POST_STATUSES].sort()).toStrictEqual(
			['failed', 'missed_approval', 'missed_schedule', 'partial', 'published', 'rejected'].sort(),
		);
	});

	it('classifies every terminal state and rejects in-flight ones', () => {
		for (const status of TERMINAL_POST_STATUSES) expect(isTerminalPostStatus(status)).toBe(true);
		for (const status of [
			'draft',
			'requires_approval',
			'changes_requested',
			'scheduled',
			'publishing',
			'',
			undefined,
			null,
			42,
		]) {
			expect(isTerminalPostStatus(status)).toBe(false);
		}
	});
});

describe('selectTerminalEmissions', () => {
	it('emits a post once when it reaches a terminal state', () => {
		const first = selectTerminalEmissions([{ postId: 'p1', status: 'published' }], {});
		expect(first.emit).toStrictEqual([{ postId: 'p1', status: 'published' }]);
		expect(first.nextEmitted).toStrictEqual({ p1: 'published' });

		const second = selectTerminalEmissions(
			[{ postId: 'p1', status: 'published' }],
			first.nextEmitted,
		);
		expect(second.emit).toStrictEqual([]);
		expect(second.nextEmitted).toStrictEqual({ p1: 'published' });
	});

	it('never emits in-flight states and does not record them', () => {
		const result = selectTerminalEmissions(
			[
				{ postId: 'p1', status: 'requires_approval' },
				{ postId: 'p2', status: 'publishing' },
			],
			{},
		);
		expect(result.emit).toStrictEqual([]);
		expect(result.nextEmitted).toStrictEqual({});
	});

	it('emits again when a post moves to a different terminal state', () => {
		const result = selectTerminalEmissions([{ postId: 'p1', status: 'failed' }], {
			p1: 'partial',
		});
		expect(result.emit).toStrictEqual([{ postId: 'p1', status: 'failed' }]);
		expect(result.nextEmitted).toStrictEqual({ p1: 'failed' });
	});

	it('handles a mixed batch and leaves the input map untouched', () => {
		const emitted = { p1: 'published' };
		const result = selectTerminalEmissions(
			[
				{ postId: 'p1', status: 'published' },
				{ postId: 'p2', status: 'failed' },
				{ postId: 'p3', status: 'scheduled' },
			],
			emitted,
		);
		expect(result.emit).toStrictEqual([{ postId: 'p2', status: 'failed' }]);
		expect(result.nextEmitted).toStrictEqual({ p1: 'published', p2: 'failed' });
		expect(emitted).toStrictEqual({ p1: 'published' });
	});
});

describe('publishOutcome', () => {
	it('treats requires_approval as a success state with approval guidance, never an error', () => {
		const outcome = publishOutcome('requires_approval');
		expect(outcome.state).toBe('requires_approval');
		expect(outcome.terminal).toBe(false);
		expect(outcome.requires_human).toBe(true);
		expect(outcome.guidance).toMatch(/^Success:/);
		expect(outcome.guidance).toContain('not an error');
	});

	it('marks draft (L0 Manual) as requiring a human without failing', () => {
		const outcome = publishOutcome('draft');
		expect(outcome.requires_human).toBe(true);
		expect(outcome.terminal).toBe(false);
	});

	it('marks exactly the terminal statuses as terminal', () => {
		for (const status of TERMINAL_POST_STATUSES) {
			expect(publishOutcome(status).terminal).toBe(true);
		}
		for (const status of [
			'draft',
			'requires_approval',
			'changes_requested',
			'scheduled',
			'publishing',
		]) {
			expect(publishOutcome(status).terminal).toBe(false);
		}
	});

	it('never throws on unknown statuses', () => {
		expect(publishOutcome('something_new').state).toBe('something_new');
		expect(publishOutcome(undefined).state).toBe('unknown');
		expect(publishOutcome(7).state).toBe('unknown');
	});
});

describe('planOutcome', () => {
	it('treats requires_approval as the designed plan-first success state', () => {
		const outcome = planOutcome('requires_approval');
		expect(outcome.requires_human).toBe(true);
		expect(outcome.terminal).toBe(false);
		expect(outcome.guidance).toMatch(/^Success:/);
	});

	it('marks approved as terminal with publish-under-plan guidance', () => {
		const outcome = planOutcome('approved');
		expect(outcome.terminal).toBe(true);
		expect(outcome.guidance).toContain('plan ID');
	});

	it('covers every plan_status enum value plus unknowns', () => {
		for (const status of [
			'requires_approval',
			'approved',
			'changes_requested',
			'rejected',
			'expired',
			'cancelled',
		]) {
			expect(planOutcome(status).state).toBe(status);
		}
		expect(planOutcome(null).state).toBe('unknown');
	});
});
