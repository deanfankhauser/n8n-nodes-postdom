import { describe, expect, it, vi } from 'vitest';

import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, INodePropertyCollection, INodePropertyOptions } from 'n8n-workflow';

import { Postdom } from '../nodes/Postdom/Postdom.node';
import type { PostdomAccount } from '../nodes/Postdom/PostdomRequests';
import {
	buildCreateImageUpload,
	buildCreateSlideshow,
	buildGetSlideshow,
	buildPublishSlideshow,
	buildPublishVideo,
	buildSimpleSlides,
	defaultTarget,
	parseMediaStatus,
	parseSlides,
	readImageInfo,
	splitMediaHandles,
	waitForSlideshow,
	withSlideshowHandles,
} from '../nodes/Postdom/PostdomRequests';

const BASE = 'https://api.example.test';
const H1 = 'pd_media_11111111-1111-4111-8111-111111111111';
const H2 = 'pd_media_22222222-2222-4222-8222-222222222222';
const H3 = 'pd_media_33333333-3333-4333-8333-333333333333';
const SLIDESHOW_ID = '3f0c7f0e-8a43-4d3c-9d55-0a4d1d0b6c11';
const ACCOUNTS: PostdomAccount[] = [
	{ providerAccountId: 'acc_tt', platform: 'tiktok' },
	{ providerAccountId: 'acc_ig', platform: 'instagram' },
	{ providerAccountId: 'acc_fb', platform: 'facebook' },
	{ providerAccountId: 'acc_li', platform: 'linkedin' },
	{ providerAccountId: 'acc_yt', platform: 'youtube' },
];

const png = (width: number, height: number) => {
	const bytes = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
	bytes.writeUInt32BE(13, 8);
	bytes.write('IHDR', 12, 'latin1');
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
};

describe('publish options shared by Publish Video and Publish Slideshow', () => {
	it('keeps every 0.5.0 default when no option is set', () => {
		expect(defaultTarget('tiktok', 'acc_tt', 'Caption')).toStrictEqual({
			account_id: 'acc_tt',
			platform: 'tiktok',
			settings: {
				privacy_level: 'PUBLIC_TO_EVERYONE',
				allow_comment: false,
				allow_duet: false,
				allow_stitch: false,
				content_preview_confirmed: true,
				express_consent_given: true,
				video_made_with_ai: true,
			},
		});
		expect(defaultTarget('instagram', 'acc_ig', 'Caption').settings).toStrictEqual({ contentType: 'reel', isAiGenerated: true });
		expect(defaultTarget('youtube', 'acc_yt', 'Title\nBody').settings).toStrictEqual({
			title: 'Title',
			visibility: 'private',
			madeForKids: false,
			containsSyntheticMedia: true,
		});
	});

	it('sends the comments, AI label, commercial content and YouTube choices as given', () => {
		const tiktok = defaultTarget('tiktok', 'acc_tt', 'c', {
			tiktokPrivacy: 'FOLLOWER_OF_CREATOR',
			allowComments: true,
			aiLabel: false,
			tiktokCommercialContent: 'brand_organic',
		});
		expect(tiktok.settings).toMatchObject({
			privacy_level: 'FOLLOWER_OF_CREATOR',
			allow_comment: true,
			video_made_with_ai: false,
			commercialContentType: 'brand_organic',
		});
		expect(defaultTarget('instagram', 'acc_ig', 'c', { aiLabel: false }).settings).toStrictEqual({
			contentType: 'reel',
			isAiGenerated: false,
		});
		expect(defaultTarget('youtube', 'acc_yt', 'c', { youtubeVisibility: 'public', youtubeTitle: ' My title ' }).settings).toStrictEqual({
			title: 'My title',
			visibility: 'public',
			madeForKids: false,
			containsSyntheticMedia: true,
		});
		expect(defaultTarget('facebook', 'acc_fb', 'c', { aiLabel: false }).settings).toStrictEqual({ contentType: 'reel' });
	});

	it('refuses values the REST target schema refuses', () => {
		expect(() => defaultTarget('youtube', 'a', 'c', { youtubeVisibility: 'everyone' })).toThrow('YouTube Visibility must be one of');
		expect(() => defaultTarget('tiktok', 'a', 'c', { tiktokCommercialContent: 'ad' })).toThrow('TikTok Commercial Content must be one of');
		expect(() => defaultTarget('tiktok', 'a', 'c', { tiktokCommercialContent: 'brand_content', tiktokPrivacy: 'SELF_ONLY' })).toThrow(
			'branded content',
		);
	});

	it('threads the options through Publish Video', () => {
		const request = buildPublishVideo(
			BASE,
			{
				accountIds: ['acc_tt', 'acc_yt'],
				videoUrl: 'https://cdn.example.test/v.mp4',
				caption: 'Caption',
				intent: 'Test',
				allowComments: true,
				youtubeVisibility: 'unlisted',
			},
			ACCOUNTS,
		);
		const targets = (request.body as { targets: Array<{ settings: Record<string, unknown> }> }).targets;
		expect(targets[0]?.settings.allow_comment).toBe(true);
		expect(targets[1]?.settings.visibility).toBe('unlisted');
	});
});

describe('slideshow requests', () => {
	it('builds POST /v1/slideshows with a bounded Prefer wait and the exact body', () => {
		const slides = [{ template: 'cover', headline: 'Hello' }, { template: 'end_card', cta: 'Follow' }];
		const request = buildCreateSlideshow(BASE, { size: '4:5', slides, idempotencyKey: 'k1', design: ' ledger@1 ' });
		expect(request).toStrictEqual({
			method: 'POST',
			url: `${BASE}/v1/slideshows`,
			headers: { Accept: 'application/json', 'X-Postdom-Source': 'n8n', 'Idempotency-Key': 'k1', Prefer: 'wait=25' },
			body: { size: '4:5', slides, design: 'ledger@1' },
			json: true,
		});
		expect(buildCreateSlideshow(BASE, { size: '3:4', slides, waitSeconds: 90 }).headers.Prefer).toBe('wait=25');
		expect(() => buildCreateSlideshow(BASE, { size: '16:9', slides })).toThrow('Slide Size must be one of');
	});

	it('reads slides JSON as text or an array and names a wrong template', () => {
		expect(parseSlides('[{"template":"cover@1","headline":"x"}]')).toStrictEqual([{ template: 'cover@1', headline: 'x' }]);
		expect(() => parseSlides('not json')).toThrow('JSON array');
		expect(() => parseSlides([])).toThrow('non-empty');
		expect(() => parseSlides([{ template: 'poster' }])).toThrow('Slide 1 template must be one of');
		expect(() => parseSlides(Array.from({ length: 21 }, () => ({ template: 'cover' })))).toThrow('at most 20');
	});

	it('builds simple slides within the core field limits', () => {
		const slides = buildSimpleSlides({
			title: 'x'.repeat(200),
			kicker: 'New on the blog',
			points: '- One\n- Two\n3. Three',
			pointsTitle: 'Three things',
			cta: '',
			handle: '@brand',
		});
		expect(slides[0]).toMatchObject({ template: 'cover', kicker: 'New on the blog' });
		expect(String(slides[0]?.headline).length).toBeLessThanOrEqual(80);
		expect(slides[1]).toStrictEqual({ template: 'list', title: 'Three things', items: ['One', 'Two', 'Three'] });
		expect(slides[2]).toStrictEqual({ template: 'end_card', cta: 'Follow for more', handle: '@brand' });
		const withPhoto = buildSimpleSlides({ title: 'T', coverImageHandle: H1, points: ['Do this. Then that.'], pointsStyle: 'steps' });
		expect(withPhoto[0]).toStrictEqual({ template: 'cover_image', headline: 'T', image_media_id: H1 });
		expect(withPhoto[1]).toStrictEqual({ template: 'step', step: 1, headline: 'Do this.', body: 'Then that.' });
		expect(() => buildSimpleSlides({ title: ' ' })).toThrow('Title is required');
	});

	it('reads a slideshow by UUID and orders its media handles', () => {
		expect(buildGetSlideshow(BASE, SLIDESHOW_ID).url).toBe(`${BASE}/v1/slideshows/${SLIDESHOW_ID}`);
		expect(() => buildGetSlideshow(BASE, '../posts')).toThrow('UUID');
		const read = withSlideshowHandles({
			slideshow_id: SLIDESHOW_ID,
			status: 'ready',
			media: [
				{ media_id: H2, position: 2 },
				{ media_id: H1, position: 1 },
			],
		});
		expect(read.media_handles).toStrictEqual([H1, H2]);
		expect(read.slide_count).toBe(2);
		expect(read.status).toBe('ready');
	});

	it('waits for rendering with bounded backoff and returns rendering honestly on timeout', async () => {
		let clock = 0;
		const sleeps: number[] = [];
		const reads = [{ status: 'rendering' }, { status: 'ready', slideshow_id: SLIDESHOW_ID }];
		const ready = await waitForSlideshow(async () => reads.shift() ?? {}, { status: 'rendering' }, {
			timeoutMs: 60_000,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
		});
		expect(ready.status).toBe('ready');
		expect(sleeps).toStrictEqual([2_000, 4_000]);
		clock = 0;
		const pending = await waitForSlideshow(async () => ({ status: 'rendering' }), { status: 'rendering' }, {
			timeoutMs: 3_000,
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
		});
		expect(pending.status).toBe('rendering');
	});
});

describe('Publish Slideshow request', () => {
	it('posts media[] in order with the app slideshow targets', () => {
		const request = buildPublishSlideshow(
			BASE,
			{
				accountIds: ['acc_tt', 'acc_ig', 'acc_fb', 'acc_li'],
				mediaHandles: [H1, H2, H3],
				caption: 'Five ways to cut your bill\nMore below',
				intent: 'Post the slideshow',
				publishAt: '2026-10-08T09:00:00Z',
				idempotencyKey: 'post-1',
			},
			ACCOUNTS,
		);
		expect(request.url).toBe(`${BASE}/v1/posts`);
		expect(request.headers['Idempotency-Key']).toBe('post-1');
		expect(request.body).toStrictEqual({
			caption: 'Five ways to cut your bill\nMore below',
			media: [{ media_handle: H1 }, { media_handle: H2 }, { media_handle: H3 }],
			publish_at: '2026-10-08T09:00:00Z',
			targets: [
				{
					account_id: 'acc_tt',
					platform: 'tiktok',
					settings: {
						privacy_level: 'PUBLIC_TO_EVERYONE',
						allow_comment: false,
						allow_duet: false,
						allow_stitch: false,
						content_preview_confirmed: true,
						express_consent_given: true,
						video_made_with_ai: true,
						auto_add_music: true,
					},
				},
				{ account_id: 'acc_ig', platform: 'instagram', surface: 'feed', settings: { contentType: 'reel', isAiGenerated: true } },
				{ account_id: 'acc_fb', platform: 'facebook', surface: 'feed', settings: { contentType: 'reel' } },
				{ account_id: 'acc_li', platform: 'linkedin', settings: { documentTitle: 'Five ways to cut your bill' } },
			],
			agent_context: { identity: 'AI agent via n8n', intent: 'Post the slideshow' },
		});
	});

	it('sends the TikTok and LinkedIn choices and leaves a single image without a document title', () => {
		const request = buildPublishSlideshow(
			BASE,
			{
				accountIds: ['acc_tt', 'acc_li'],
				mediaHandles: [H1],
				caption: 'One',
				intent: 'x',
				tiktokPrivacy: 'SELF_ONLY',
				allowComments: true,
				tiktokAutoAddMusic: false,
				aiLabel: false,
				linkedinDocumentTitle: 'Ignored for one image',
			},
			ACCOUNTS,
		);
		const [tiktok, linkedin] = (request.body as { targets: Array<Record<string, unknown>> }).targets;
		expect(tiktok?.settings).toMatchObject({ privacy_level: 'SELF_ONLY', allow_comment: true, auto_add_music: false, video_made_with_ai: false });
		expect(linkedin?.settings).toStrictEqual({});
	});

	it('refuses non-carousel destinations, too many images and bad handles before any request', () => {
		const input = { accountIds: ['acc_yt'], mediaHandles: [H1, H2], caption: 'c', intent: 'i' };
		expect(() => buildPublishSlideshow(BASE, input, ACCOUNTS)).toThrow('Slideshows post to TikTok, Instagram, Facebook and LinkedIn');
		const eleven = Array.from({ length: 11 }, () => H1);
		expect(() => buildPublishSlideshow(BASE, { ...input, accountIds: ['acc_ig'], mediaHandles: eleven }, ACCOUNTS)).toThrow(
			'Instagram takes at most 10 images',
		);
		expect(() => buildPublishSlideshow(BASE, { ...input, accountIds: ['acc_tt'], mediaHandles: [] }, ACCOUNTS)).toThrow('empty');
		expect(() => buildPublishSlideshow(BASE, { ...input, accountIds: ['acc_tt'], mediaHandles: ['nope'] }, ACCOUNTS)).toThrow(
			'valid Postdom media handle',
		);
	});

	it('splits media handles from an array or text', () => {
		expect(splitMediaHandles([H1, H2])).toStrictEqual([H1, H2]);
		expect(splitMediaHandles(`${H1}, ${H2}\n${H3}`)).toStrictEqual([H1, H2, H3]);
		expect(splitMediaHandles('')).toStrictEqual([]);
	});
});

describe('image uploads', () => {
	it('reads PNG, JPEG, GIF and WebP sizes from bytes and refuses anything else', () => {
		expect(readImageInfo(png(1080, 1350))).toStrictEqual({ contentType: 'image/png', width: 1080, height: 1350 });
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x46, 0x04, 0x38, 0x03, 0, 0, 0]);
		expect(readImageInfo(jpeg)).toStrictEqual({ contentType: 'image/jpeg', width: 1080, height: 1350 });
		const gif = Buffer.from('GIF89a\x38\x04\x46\x05\x00', 'latin1');
		expect(readImageInfo(gif)).toStrictEqual({ contentType: 'image/gif', width: 1080, height: 1350 });
		const webp = Buffer.alloc(30);
		webp.write('RIFF', 0, 'latin1');
		webp.write('WEBP', 8, 'latin1');
		webp.write('VP8X', 12, 'latin1');
		webp.writeUIntLE(1079, 24, 3);
		webp.writeUIntLE(1349, 27, 3);
		expect(readImageInfo(webp)).toStrictEqual({ contentType: 'image/webp', width: 1080, height: 1350 });
		expect(readImageInfo(Buffer.from('<html>'))).toBeNull();
	});

	it('declares an image upload without a duration or platforms', () => {
		const request = buildCreateImageUpload(BASE, { contentType: 'image/png', sizeBytes: 33, widthPixels: 1080, heightPixels: 1350, idempotencyKey: 'img' });
		expect(request.url).toBe(`${BASE}/v1/media/uploads`);
		expect(request.body).toStrictEqual({ content_type: 'image/png', size_bytes: 33, width_pixels: 1080, height_pixels: 1350 });
		expect(() => buildCreateImageUpload(BASE, { contentType: 'image/png', sizeBytes: 33, widthPixels: 0, heightPixels: 1 })).toThrow(
			'could not be read',
		);
	});

	it('accepts an image status read', () => {
		expect(
			parseMediaStatus({ media_handle: H1, status: 'stored', content_type: 'image/png', size_bytes: 33, media_url: 'https://m.example.test/a.png', failure_reason: null, kind: 'image' }),
		).toMatchObject({ status: 'stored', content_type: 'image/png' });
	});
});

describe('node descriptions for the new operations', () => {
	const properties = new Postdom().description.properties;
	const additional = (operation: string) => {
		const collection = properties.find(
			(property) =>
				property.name === 'additionalFields' &&
				(property.displayOptions?.show?.operation as string[] | undefined)?.includes(operation),
		);
		return (collection?.options ?? []) as Array<INodePropertyOptions | INodePropertyCollection | { name: string; default: unknown; options?: Array<{ value: unknown }> }>;
	};

	it('defaults TikTok to Everyone and the AI label to on for both publish operations', () => {
		for (const operation of ['publishVideo', 'publishSlideshow']) {
			const fields = additional(operation) as Array<{ name: string; default: unknown; options?: Array<{ value: unknown }> }>;
			expect(fields.find((field) => field.name === 'tiktokPrivacy')?.default).toBe('PUBLIC_TO_EVERYONE');
			expect(fields.find((field) => field.name === 'tiktokPrivacy')?.options?.map((option) => option.value).sort()).toStrictEqual(
				['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
			);
			expect(fields.find((field) => field.name === 'aiLabel')?.default).toBe(true);
			expect(fields.some((field) => field.name === 'allowComments')).toBe(true);
		}
		const video = additional('publishVideo') as Array<{ name: string; options?: Array<{ value: unknown }> }>;
		expect(video.find((field) => field.name === 'youtubeVisibility')?.options?.map((option) => option.value).sort()).toStrictEqual(
			['private', 'public', 'unlisted'],
		);
		expect((additional('publishSlideshow') as Array<{ name: string }>).some((field) => field.name === 'youtubeVisibility')).toBe(false);
	});

	it('keeps every collection and option list alphabetical, as n8n lint requires', () => {
		for (const property of properties) {
			const names = ((property.options ?? []) as Array<{ name?: string; displayName?: string }>).map((option) => option.displayName ?? option.name ?? '');
			if (property.type === 'collection') expect(names, property.name).toStrictEqual([...names].sort((a, b) => a.localeCompare(b)));
		}
	});
});

describe('slideshow and image execution', () => {
	const node = { name: 'Postdom', type: 'postdom', typeVersion: 1, position: [0, 0] };
	const contextFor = (
		parameters: Record<string, unknown>,
		authenticated: (name: string, options: IHttpRequestOptions) => Promise<unknown>,
		direct: (options: IHttpRequestOptions) => Promise<unknown> = async () => ({}),
	) =>
		({
			getInputData: () => [{ json: {} }],
			getCredentials: async () => ({ apiKey: 'pd_live_secret', baseUrl: BASE }),
			getNodeParameter: (name: string) => parameters[name],
			getNode: () => node,
			continueOnFail: () => false,
			helpers: { httpRequestWithAuthentication: vi.fn(authenticated), httpRequest: vi.fn(direct) },
		}) as unknown as IExecuteFunctions;

	it('creates a slideshow, polls a 202 until ready and returns the ordered handles', async () => {
		const calls: IHttpRequestOptions[] = [];
		const context = contextFor(
			{
				resource: 'slideshow',
				operation: 'create',
				size: '4:5',
				slidesInput: 'json',
				slidesJson: '[{"template":"cover","headline":"Hi"},{"template":"end_card","cta":"Follow"}]',
				waitForReady: true,
				waitTimeoutSeconds: 1,
				additionalFields: {},
			},
			async (_name, options) => {
				calls.push(options);
				if (options.method === 'POST') return { statusCode: 202, body: { slideshow_id: SLIDESHOW_ID, status: 'rendering', media: [] } };
				return {
					statusCode: 200,
					body: { slideshow_id: SLIDESHOW_ID, status: 'ready', media: [{ media_id: H2, position: 2 }, { media_id: H1, position: 1 }] },
				};
			},
		);
		const output = await new Postdom().execute.call(context);
		expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/v1/slideshows`, returnFullResponse: true, ignoreHttpStatusErrors: true });
		expect(calls[0]?.headers).toMatchObject({ Prefer: 'wait=25' });
		expect(calls[1]).toMatchObject({ method: 'GET', url: `${BASE}/v1/slideshows/${SLIDESHOW_ID}` });
		expect(output[0]?.[0]?.json).toMatchObject({ status: 'ready', media_handles: [H1, H2], slide_count: 2 });
	});

	it('turns a 422 refusal into one readable error naming each field', async () => {
		const context = contextFor(
			{ resource: 'slideshow', operation: 'create', size: '4:5', slidesInput: 'fields', title: 'T', points: '', cta: '', slideOptions: {}, waitForReady: true, waitTimeoutSeconds: 5, additionalFields: {} },
			async () => ({
				statusCode: 422,
				body: { code: 'slides_do_not_fit', detail: '1 slide field(s) do not fit', refusals: [{ slide: 1, field: 'headline', reason: 'too long at 4:5' }] },
			}),
		);
		await expect(new Postdom().execute.call(context)).rejects.toThrow('slide 1 headline: too long at 4:5');
	});

	it('uploads an image from a URL with no Postdom credential on the download or the PUT', async () => {
		const bytes = png(1080, 1350);
		const authenticatedCalls: IHttpRequestOptions[] = [];
		const directCalls: IHttpRequestOptions[] = [];
		const context = contextFor(
			{ resource: 'media', operation: 'uploadImageFromUrl', imageUrl: 'https://shop.example.test/p.png', waitForStorage: true, waitTimeoutSeconds: 5 },
			async (_name, options) => {
				authenticatedCalls.push(options);
				if (options.method === 'POST') {
					return {
						media_handle: H1,
						upload_url: 'https://r2.example.test/signed',
						method: 'PUT',
						headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length) },
						expires_at: new Date(Date.now() + 60_000).toISOString(),
					} as IDataObject;
				}
				return { media_handle: H1, status: 'stored', content_type: 'image/png', size_bytes: bytes.length, media_url: 'https://m.example.test/p.png', failure_reason: null, kind: 'image' };
			},
			async (options) => {
				directCalls.push(options);
				return options.method === 'GET' ? bytes : {};
			},
		);
		const output = await new Postdom().execute.call(context);
		expect(authenticatedCalls[0]?.body).toStrictEqual({ content_type: 'image/png', size_bytes: bytes.length, width_pixels: 1080, height_pixels: 1350 });
		expect(directCalls.map((call) => [call.method, call.url])).toStrictEqual([
			['GET', 'https://shop.example.test/p.png'],
			['PUT', 'https://r2.example.test/signed'],
		]);
		for (const call of directCalls) expect(call.headers ?? {}).not.toHaveProperty('Authorization');
		expect(JSON.stringify(output)).not.toContain('r2.example.test/signed');
		expect(output[0]?.[0]?.json).toMatchObject({ media_handle: H1, status: 'stored', width_pixels: 1080, height_pixels: 1350 });
	});

	it('publishes a slideshow from mapped media handles with approval guidance', async () => {
		const posts: IHttpRequestOptions[] = [];
		const context = contextFor(
			{
				resource: 'post',
				operation: 'publishSlideshow',
				accountIds: 'acc_ig',
				mediaHandles: [H1, H2],
				caption: 'Caption',
				intent: 'Post it',
				agentIdentity: 'n8n test',
				planId: '',
				additionalFields: { tiktokPrivacy: 'PUBLIC_TO_EVERYONE' },
			},
			async (_name, options) => {
				if (options.method === 'GET') return { accounts: ACCOUNTS };
				posts.push(options);
				return { id: 'post_1', status: 'requires_approval' };
			},
		);
		const output = await new Postdom().execute.call(context);
		expect(posts[0]?.body).toMatchObject({ media: [{ media_handle: H1 }, { media_handle: H2 }], agent_context: { identity: 'n8n test' } });
		expect(output[0]?.[0]?.json).toMatchObject({ status: 'requires_approval', postdom_n8n_guidance: { requires_human: true } });
	});
});
