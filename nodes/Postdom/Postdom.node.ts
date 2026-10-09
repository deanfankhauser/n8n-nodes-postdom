import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import type {
	DirectMediaPutRequest,
	MediaContentType,
	PerformanceMetric,
	PerformanceWindow,
	PostdomAccount,
	PostdomPlatform,
	PostdomRequest,
} from './PostdomRequests';
import {
	buildConnectAccount,
	buildCreateImageUpload,
	buildCreateMediaUpload,
	buildCreateSlideshow,
	buildDirectMediaPut,
	buildGetAccountPerformance,
	buildGetBestPosts,
	buildGetBrief,
	buildGetDigest,
	buildGetMediaStatus,
	buildGetPlan,
	buildGetPost,
	buildGetPostPerformance,
	buildGetSlideshow,
	buildGetWorkspaceStatus,
	buildListAccounts,
	buildPublishSlideshow,
	buildPublishVideo,
	buildSimpleSlides,
	buildSubmitPlan,
	CONNECT_DESTINATIONS,
	destinationOptions,
	MEDIA_CONTENT_TYPES,
	MEDIA_MAX_BYTES,
	parseSlides,
	readImageInfo,
	slideshowRefusalMessage,
	splitMediaHandles,
	waitForSlideshow,
	withSlideshowHandles,
	REDIRECT_DESTINATIONS,
	normalizeBaseUrl,
	parseMediaStatus,
	parseMediaUploadContract,
	planGuidance,
	publishGuidance,
	withN8nGuidance,
	waitForMediaStorage,
} from './PostdomRequests';

const WINDOW_OPTIONS = [
	{ name: '7 Days', value: '7d' },
	{ name: '30 Days', value: '30d' },
];

export class Postdom implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Postdom',
		name: 'postdom',
		icon: { light: 'file:postdom.svg', dark: 'file:postdom.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Create branded slideshows, upload media, publish short-form video and slideshows, submit bounded publication plans, and read performance from a Postdom workspace',
		defaults: {
			name: 'Postdom',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'postdomApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Brief', value: 'brief' },
					{ name: 'Digest', value: 'digest' },
					{ name: 'Media', value: 'media' },
					{ name: 'Plan', value: 'plan' },
					{ name: 'Post', value: 'post' },
					{ name: 'Slideshow', value: 'slideshow' },
					{ name: 'Workspace', value: 'workspace' },
				],
				default: 'workspace',
			},

			// Media ----------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['media'] } },
				options: [
					{
						name: 'Get Status',
						value: 'getStatus',
						action: 'Get media status',
						description: 'Read whether an uploaded video is pending, stored, or failed',
					},
					{
						name: 'Upload',
						value: 'upload',
						action: 'Upload media',
						description:
							'Upload a video binary directly to Postdom private storage and return its opaque media handle',
					},
					{
						name: 'Upload Image From URL',
						value: 'uploadImageFromUrl',
						action: 'Upload an image from a URL',
						description:
							'Download a PNG, JPEG, GIF or WebP from a URL, read its real size, store it privately in Postdom, and return its media handle (for a slideshow photo)',
					},
				],
				default: 'upload',
			},

			// Workspace ------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['workspace'] } },
				options: [
					{
						name: 'Get Status',
						value: 'getStatus',
						action: 'Get workspace status',
						description:
							'Read connected-account health, autonomy and policy state, brief version, activity counts, billing state, and the connection gate',
					},
				],
				default: 'getStatus',
			},

			// Account --------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Connect',
						value: 'connect',
						action: 'Connect a social account',
						description:
							'Create a platform OAuth URL. Hand the returned URL to a human; never ask for or handle their social password.',
					},
					{
						name: 'Get Best Posts',
						value: 'getBestPosts',
						action: 'Get best posts for an account',
						description:
							'Rank one connected account\'s posts by an evidence-backed metric over the requested window',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many accounts',
						description: 'Get the destination accounts available inside this workspace',
					},
					{
						name: 'Get Performance',
						value: 'getPerformance',
						action: 'Get account performance',
						description:
							'Read normalized performance snapshots for one connected account. Metric availability states (available, delayed, estimable, never, unverified) are passed through honestly; unavailable metrics stay null with reasons instead of being coerced to zero.',
					},
				],
				default: 'getAll',
			},

			// Plan -----------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['plan'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get a publication plan',
						description: 'Read plan status and structured feedback from the human reviewer',
					},
					{
						name: 'Submit',
						value: 'submit',
						action: 'Submit a publication plan',
						description: 'Submit a time-bounded publication plan for one human approval',
					},
				],
				default: 'get',
			},

			// Post -----------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['post'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get a post',
						description:
							'Read publish state and any structured approval feedback returned by the human reviewer',
					},
					{
						name: 'Get Performance',
						value: 'getPerformance',
						action: 'Get post performance',
						description:
							'Read normalized performance snapshots for one post. Metric availability states (available, delayed, estimable, never, unverified) are passed through honestly; unavailable metrics stay null with reasons instead of being coerced to zero.',
					},
					{
						name: 'Publish Slideshow',
						value: 'publishSlideshow',
						action: 'Publish a slideshow',
						description:
							'Post a rendered slideshow as one multi-image post to TikTok, Instagram, Facebook or LinkedIn, optionally scheduled in UTC. Account policy and review rules apply; landing in review is a success state, never an error.',
					},
					{
						name: 'Publish Video',
						value: 'publishVideo',
						action: 'Publish a video',
						description:
							'Create a short-form video publish with each provider\'s supported safety defaults, optionally scheduled in UTC. Posts flow automatically inside an account\'s policy or await review on review-mode accounts; landing in review is a success state, never an error.',
					},
				],
				default: 'get',
			},

			// Slideshow ------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['slideshow'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						action: 'Create a slideshow',
						description:
							'Render branded slides on the workspace brand kit from your own words and photos, one template a slide, and return their media handles in order for Post -> Publish Slideshow',
					},
					{
						name: 'Get',
						value: 'get',
						action: 'Get a slideshow',
						description: 'Read whether a slideshow is rendering, ready, refused or failed, with its slides once ready',
					},
				],
				default: 'create',
			},

			// Brief ----------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['brief'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get the workspace brief',
						description:
							'Read the current workspace-owned brand guidance before planning or writing content',
					},
				],
				default: 'get',
			},

			// Digest ---------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['digest'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get the latest digest',
						description:
							'Read the latest completed weekly workspace digest. It describes observed outcomes; it does not recommend actions.',
					},
				],
				default: 'get',
			},

			// Account: Connect fields ---------------------------------------
			{
				displayName: 'Platform',
				name: 'platform',
				type: 'options',
				required: true,
				displayOptions: { show: { resource: ['account'], operation: ['connect'] } },
				// REDIRECT_DESTINATIONS, not CONNECT_DESTINATIONS, and the difference is the
				// whole point of this operation. This returns an OAuth URL; Bluesky authorises
				// with an app password and has no authorization URL, so offering it here would
				// ship a control that cannot succeed and surface a supplier-named error the
				// customer cannot act on. Same narrowing the MCP connect_account tool has.
				options: destinationOptions(REDIRECT_DESTINATIONS),
				default: 'tiktok',
				description:
					'Platform to create an OAuth connect URL for. Destinations that authorise with an app password instead are connected by a human in the Postdom dashboard and are deliberately absent from this list.',
			},

			// Media fields ---------------------------------------------------
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['media'], operation: ['upload'] } },
				default: 'data',
				description: 'Name of the input binary property containing an MP4 or QuickTime video',
			},
			{
				displayName: 'Target Platforms',
				name: 'platforms',
				type: 'multiOptions',
				required: true,
				displayOptions: { show: { resource: ['media'], operation: ['upload'] } },
				// CONNECT_DESTINATIONS, the full offered set, because this asks which
				// destinations the video will be validated for rather than how an account is
				// authorised. A customer who connected Bluesky by app password can upload for
				// it, so narrowing this to the redirect list would withhold a destination they
				// already have. The two pickers in this node answer different questions and
				// were previously the same stale four.
				options: destinationOptions(CONNECT_DESTINATIONS),
				default: ['tiktok'],
				description: 'Platforms this video will be validated for before an upload URL is issued',
			},
			{
				displayName: 'Video Width (Pixels)',
				name: 'widthPixels',
				type: 'number',
				typeOptions: { minValue: 1, numberPrecision: 0 },
				required: true,
				displayOptions: { show: { resource: ['media'], operation: ['upload'] } },
				default: 0,
				description: 'Actual video width in pixels. Replace the unset zero with measured metadata; do not assume a resolution.',
			},
			{
				displayName: 'Video Height (Pixels)',
				name: 'heightPixels',
				type: 'number',
				typeOptions: { minValue: 1, numberPrecision: 0 },
				required: true,
				displayOptions: { show: { resource: ['media'], operation: ['upload'] } },
				default: 0,
				description: 'Actual video height in pixels. Replace the unset zero with measured metadata; Postdom validates platform limits.',
			},
			{
				displayName: 'Video Duration (Seconds)',
				name: 'durationSeconds',
				type: 'number',
				typeOptions: { minValue: 1, numberPrecision: 0 },
				required: true,
				displayOptions: { show: { resource: ['media'], operation: ['upload'] } },
				default: 0,
				description: 'Actual positive whole-second video duration required by Postdom preflight. Zero is unset and rejected.',
			},
			{
				displayName: 'Wait for Storage',
				name: 'waitForStorage',
				type: 'boolean',
				displayOptions: { show: { resource: ['media'], operation: ['upload'] } },
				default: true,
				description:
					'Whether to poll with bounded backoff until the upload is stored or failed. A timeout returns pending honestly.',
			},
			{
				displayName: 'Wait Timeout (Seconds)',
				name: 'waitTimeoutSeconds',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 300 },
				displayOptions: {
					show: { resource: ['media'], operation: ['upload'], waitForStorage: [true] },
				},
				default: 120,
				description: 'Maximum time to wait; pending is returned if storage is not confirmed in time',
			},
			{
				displayName: 'Media Handle',
				name: 'mediaHandle',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['media'], operation: ['getStatus'] } },
				default: '',
				placeholder: 'pd_media_11111111-1111-4111-8111-111111111111',
				description: 'Opaque handle returned by Media Upload',
			},
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['media'], operation: ['uploadImageFromUrl'] } },
				default: '',
				placeholder: 'https://example.com/product.jpg',
				description:
					'Public URL of a PNG, JPEG, GIF or WebP image. The node reads its real type and pixel size from the file.',
			},
			{
				displayName: 'Wait for Storage',
				name: 'waitForStorage',
				type: 'boolean',
				displayOptions: { show: { resource: ['media'], operation: ['uploadImageFromUrl'] } },
				default: true,
				description:
					'Whether to poll with bounded backoff until the image is stored or failed. A timeout returns pending honestly.',
			},
			{
				displayName: 'Wait Timeout (Seconds)',
				name: 'waitTimeoutSeconds',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 300 },
				displayOptions: {
					show: { resource: ['media'], operation: ['uploadImageFromUrl'], waitForStorage: [true] },
				},
				default: 60,
				description: 'Maximum time to wait; pending is returned if storage is not confirmed in time',
			},
			{
				displayName: 'Redirect URL',
				name: 'redirectUrl',
				type: 'string',
				displayOptions: { show: { resource: ['account'], operation: ['connect'] } },
				default: 'https://app.postdom.com/accounts',
				description:
					'Where the human lands after finishing the platform OAuth flow. The origin must be allowlisted by the Postdom API.',
			},

			// Account: Get Performance / Get Best Posts fields ---------------
			{
				displayName: 'Account ID',
				name: 'accountId',
				type: 'string',
				required: true,
				displayOptions: {
					show: { resource: ['account'], operation: ['getPerformance', 'getBestPosts'] },
				},
				default: '',
				description: 'Provider account ID as returned by the List operation',
			},
			{
				displayName: 'Metric',
				name: 'metric',
				type: 'options',
				required: true,
				displayOptions: { show: { resource: ['account'], operation: ['getBestPosts'] } },
				options: [
					{ name: 'Average Watch Percentage', value: 'avg_watch_pct' },
					{ name: 'Comments', value: 'comments' },
					{ name: 'Completion Percentage', value: 'completion_pct' },
					{ name: 'Follower Delta', value: 'follower_delta' },
					{ name: 'Likes', value: 'likes' },
					{ name: 'Saves', value: 'saves' },
					{ name: 'Shares', value: 'shares' },
					{ name: 'Views', value: 'views' },
					{ name: 'Watch Time (Seconds)', value: 'watch_time_s' },
				],
				default: 'views',
				description: 'Evidence-backed metric to rank posts by',
			},
			{
				displayName: 'Window',
				name: 'window',
				type: 'options',
				displayOptions: {
					show: { resource: ['account'], operation: ['getPerformance', 'getBestPosts'] },
				},
				options: WINDOW_OPTIONS,
				default: '7d',
				description: 'Measurement window',
			},

			// Plan: Get fields ----------------------------------------------
			{
				displayName: 'Plan ID',
				name: 'planId',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['plan'], operation: ['get'] } },
				default: '',
				description: 'UUID of the plan to read',
			},

			// Plan: Submit fields -------------------------------------------
			{
				displayName: 'Account IDs',
				name: 'accountIds',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['plan'], operation: ['submit'] } },
				default: '',
				placeholder: 'acc_123, acc_456',
				description:
					'Comma-separated provider account IDs the plan targets. Each must already be connected; use the Account Get Many operation to look them up.',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['plan'], operation: ['submit'] } },
				default: '',
				description: 'Plan title shown to the human reviewer (max 120 characters)',
			},
			{
				displayName: 'Objective',
				name: 'objective',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['plan'], operation: ['submit'] } },
				default: '',
				description: 'What the plan is trying to achieve (max 1000 characters)',
			},
			{
				displayName: 'Starts At',
				name: 'startsAt',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['plan'], operation: ['submit'] } },
				default: '',
				placeholder: '2026-09-01T09:00:00Z',
				description: 'Plan window start as a UTC ISO 8601 timestamp ending in Z',
			},
			{
				displayName: 'Ends At',
				name: 'endsAt',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['plan'], operation: ['submit'] } },
				default: '',
				placeholder: '2026-09-08T09:00:00Z',
				description:
					'Plan window end as a UTC ISO 8601 timestamp ending in Z. Plan windows cannot exceed 14 days.',
			},
			{
				displayName: 'Max Posts',
				name: 'maxPosts',
				type: 'number',
				required: true,
				displayOptions: { show: { resource: ['plan'], operation: ['submit'] } },
				typeOptions: { minValue: 1, maxValue: 20 },
				default: 1,
				description: 'Upper bound on posts the plan may create (1 to 20)',
			},
			{
				displayName: 'Intent',
				name: 'intent',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['plan'], operation: ['submit'] } },
				default: '',
				description: 'One-line statement of why this plan is being submitted (max 500 characters)',
			},
			{
				displayName: 'Agent Identity',
				name: 'agentIdentity',
				type: 'string',
				displayOptions: { show: { resource: ['plan'], operation: ['submit'] } },
				default: 'AI agent via n8n',
				description:
					'Identity recorded on the plan and shown to the human reviewer alongside the intent',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: { show: { resource: ['plan'], operation: ['submit'] } },
				default: {},
				options: [
					{
						displayName: 'Brief Version',
						name: 'briefVersion',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 1,
						description: 'Workspace brief version the plan was written against',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description:
							'Stable key to make retries safe. Leave empty to auto-generate a fresh key per execution.',
					},
				],
			},

			// Post: Get / Get Performance fields ----------------------------
			{
				displayName: 'Post ID',
				name: 'postId',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['post'], operation: ['get', 'getPerformance'] } },
				default: '',
				description: 'ID of the post to read',
			},

			// Post: Publish Video fields ------------------------------------
			{
				displayName: 'Account IDs',
				name: 'accountIds',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['post'], operation: ['publishVideo'] } },
				default: '',
				placeholder: 'acc_123, acc_456',
				description:
					'Comma-separated provider account IDs to publish to. Each must already be connected; use the Account Get Many operation to look them up.',
			},
			{
				displayName: 'Video Source',
				name: 'videoSource',
				type: 'options',
				required: true,
				displayOptions: { show: { resource: ['post'], operation: ['publishVideo'] } },
				options: [
					{ name: 'Media Handle', value: 'mediaHandle' },
					{ name: 'Video URL', value: 'videoUrl' },
				],
				default: 'videoUrl',
				description: 'Choose one source for the video',
			},
			{
				displayName: 'Video URL',
				name: 'videoUrl',
				type: 'string',
				required: true,
				displayOptions: {
					show: { resource: ['post'], operation: ['publishVideo'], videoSource: ['videoUrl'] },
				},
				default: '',
				description: 'Publicly fetchable URL of the video file to publish',
			},
			{
				displayName: 'Media Handle',
				name: 'mediaHandle',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['publishVideo'],
						videoSource: ['mediaHandle'],
					},
				},
				default: '',
				placeholder: 'pd_media_11111111-1111-4111-8111-111111111111',
				description: 'Opaque handle returned by Media Upload',
			},
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['post'], operation: ['publishVideo'] } },
				typeOptions: { rows: 3 },
				default: '',
				description:
					'Caption for the post (max 4000 characters). The first line also becomes the YouTube title.',
			},
			{
				displayName: 'Intent',
				name: 'intent',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['post'], operation: ['publishVideo'] } },
				default: '',
				description: 'One-line statement of why this publish is happening (max 500 characters)',
			},
			{
				displayName: 'Plan ID',
				name: 'planId',
				type: 'string',
				displayOptions: { show: { resource: ['post'], operation: ['publishVideo'] } },
				default: '',
				placeholder: '3e4c8a4e-2f4b-4b6e-9a44-3a1a1c2d3e4f',
				description:
					'UUID of an approved plan this publish claims. Plan-first is the recommended flow: Submit Plan, get one human approval, then publish under the plan so posts flow inside its bounds without per-post review. Leave empty for a standalone publish, which may await review on review-mode accounts.',
			},
			{
				displayName: 'Agent Identity',
				name: 'agentIdentity',
				type: 'string',
				displayOptions: { show: { resource: ['post'], operation: ['publishVideo'] } },
				default: 'AI agent via n8n',
				description:
					'Identity recorded on the publish and shown to the human reviewer alongside the intent',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: { show: { resource: ['post'], operation: ['publishVideo'] } },
				default: {},
				options: [
					{
						displayName: 'AI Label',
						name: 'aiLabel',
						type: 'boolean',
						default: true,
						description:
							'Whether to mark the post as AI-generated on TikTok, Instagram and YouTube. On unless you turn it off. Facebook has no such setting.',
					},
					{
						displayName: 'Allow Comments (TikTok)',
						name: 'allowComments',
						type: 'boolean',
						default: false,
						description: 'Whether people can comment on the TikTok post. Other destinations ignore this.',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description:
							'Stable key to make retries safe. Leave empty to auto-generate a fresh key per execution.',
					},
					{
						displayName: 'Publish At',
						name: 'publishAt',
						type: 'string',
						default: '',
						placeholder: '2026-09-01T09:00:00Z',
						description:
							'Schedule time as a UTC ISO 8601 timestamp ending in Z. Leave empty to publish now.',
					},
					{
						displayName: 'TikTok Commercial Content',
						name: 'tiktokCommercialContent',
						type: 'options',
						default: 'none',
						description:
							'TikTok content disclosure: whether the post promotes your own business or another brand. Other destinations ignore this.',
						options: [
							{ name: 'Another Brand (Paid Partnership)', value: 'brand_content' },
							{ name: 'None', value: 'none' },
							{ name: 'Your Own Brand', value: 'brand_organic' },
						],
					},
					{
						displayName: 'TikTok Privacy',
						name: 'tiktokPrivacy',
						type: 'options',
						default: 'PUBLIC_TO_EVERYONE',
						description: 'Who can watch the video on TikTok. Other destinations ignore this.',
						options: [
							{ name: 'Everyone', value: 'PUBLIC_TO_EVERYONE' },
							{ name: 'Followers', value: 'FOLLOWER_OF_CREATOR' },
							{ name: 'Friends', value: 'MUTUAL_FOLLOW_FRIENDS' },
							{ name: 'Only Me', value: 'SELF_ONLY' },
						],
					},
					{
						displayName: 'YouTube Title',
						name: 'youtubeTitle',
						type: 'string',
						default: '',
						description:
							'Title of the YouTube video (max 100 characters). Leave empty to use the first line of the caption.',
					},
					{
						displayName: 'YouTube Visibility',
						name: 'youtubeVisibility',
						type: 'options',
						default: 'private',
						description: 'Who can watch the video on YouTube. Other destinations ignore this.',
						options: [
							{ name: 'Private', value: 'private' },
							{ name: 'Public', value: 'public' },
							{ name: 'Unlisted', value: 'unlisted' },
						],
					},
				],
			},

			// Slideshow: Create fields --------------------------------------
			{
				displayName: 'Slide Size',
				name: 'size',
				type: 'options',
				required: true,
				displayOptions: { show: { resource: ['slideshow'], operation: ['create'] } },
				options: [
					{ name: '1:1 (Square)', value: '1:1' },
					{ name: '3:4 (TikTok Photo Post)', value: '3:4' },
					{ name: '4:5 (Instagram, LinkedIn)', value: '4:5' },
					{ name: '9:16 (Full Screen)', value: '9:16' },
				],
				default: '4:5',
				description: 'Shape of every slide',
			},
			{
				displayName: 'Slides From',
				name: 'slidesInput',
				type: 'options',
				displayOptions: { show: { resource: ['slideshow'], operation: ['create'] } },
				options: [
					{
						name: 'Simple Fields',
						value: 'fields',
						description: 'A cover, your points as a list or steps, and an end card',
					},
					{
						name: 'Slides JSON',
						value: 'json',
						description: 'Any templates, one object a slide, for example mapped from a Code node',
					},
				],
				default: 'fields',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['slideshow'], operation: ['create'], slidesInput: ['fields'] } },
				default: '',
				description: 'The cover headline. Up to 80 characters (90 with a cover photo); longer text is shortened at a word.',
			},
			{
				displayName: 'Points',
				name: 'points',
				type: 'string',
				typeOptions: { rows: 4 },
				displayOptions: { show: { resource: ['slideshow'], operation: ['create'], slidesInput: ['fields'] } },
				default: '',
				description: 'One point per line, up to 5',
			},
			{
				displayName: 'Call to Action',
				name: 'cta',
				type: 'string',
				displayOptions: { show: { resource: ['slideshow'], operation: ['create'], slidesInput: ['fields'] } },
				default: '',
				placeholder: 'Read the full post. Link in bio.',
				description: 'The end card text. Up to 60 characters. Empty uses "Follow for more".',
			},
			{
				displayName: 'Slide Options',
				name: 'slideOptions',
				type: 'collection',
				placeholder: 'Add Option',
				displayOptions: { show: { resource: ['slideshow'], operation: ['create'], slidesInput: ['fields'] } },
				default: {},
				options: [
					{
						displayName: 'Cover Photo (Media Handle)',
						name: 'coverImageHandle',
						type: 'string',
						default: '',
						placeholder: 'pd_media_11111111-1111-4111-8111-111111111111',
						description: 'Image handle from Media -> Upload Image From URL, drawn behind the title',
					},
					{
						displayName: 'Handle',
						name: 'handle',
						type: 'string',
						default: '',
						placeholder: '@yourbrand',
						description: 'Your @handle on the end card. Up to 28 characters.',
					},
					{
						displayName: 'Kicker',
						name: 'kicker',
						type: 'string',
						default: '',
						description: 'A short line above the title, such as "New on the blog". Up to 32 characters.',
					},
					{
						displayName: 'List Title',
						name: 'pointsTitle',
						type: 'string',
						default: '',
						description: 'Title of the list slide. Up to 48 characters.',
					},
					{
						displayName: 'Show Points As',
						name: 'pointsStyle',
						type: 'options',
						default: 'list',
						options: [
							{ name: 'One List Slide', value: 'list' },
							{ name: 'One Slide per Step', value: 'steps' },
						],
					},
				],
			},
			{
				displayName: 'Slides (JSON)',
				name: 'slidesJson',
				type: 'json',
				required: true,
				displayOptions: { show: { resource: ['slideshow'], operation: ['create'], slidesInput: ['json'] } },
				default: '[\n  { "template": "cover", "headline": "Five ways to cut your energy bill" },\n  { "template": "list", "items": ["Seal the gaps", "Turn it down a degree", "Wash at 30"] },\n  { "template": "end_card", "cta": "Follow for more", "handle": "@yourbrand" }\n]',
				description:
					'An array of slides, one template each: cover, cover_image, text_image, list, checklist, step, stat, compare, quote, myth_fact, end_card. Refusals name every field that does not fit. See postdom.com/docs.',
			},
			{
				displayName: 'Wait for Slides',
				name: 'waitForReady',
				type: 'boolean',
				displayOptions: { show: { resource: ['slideshow'], operation: ['create'] } },
				default: true,
				description:
					'Whether to keep checking until the slides are rendered. Off, or on a timeout, the item comes back with status rendering and its slideshow_id for Slideshow -> Get.',
			},
			{
				displayName: 'Wait Timeout (Seconds)',
				name: 'waitTimeoutSeconds',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 300 },
				displayOptions: {
					show: { resource: ['slideshow'], operation: ['create'], waitForReady: [true] },
				},
				default: 90,
				description: 'Maximum time to wait after the first answer; rendering is returned if the slides are not ready in time',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: { show: { resource: ['slideshow'], operation: ['create'] } },
				default: {},
				options: [
					{
						displayName: 'Design',
						name: 'design',
						type: 'string',
						default: '',
						description:
							'Optional design template to draw every slide with. Slides fall back to the brand kit templates when it does not fit; the fallback is noted on the slideshow.',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description:
							'The same key returns the same slideshow, so a retried execution does not render twice. Leave empty to auto-generate one.',
					},
				],
			},

			// Slideshow: Get fields -----------------------------------------
			{
				displayName: 'Slideshow ID',
				name: 'slideshowId',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['slideshow'], operation: ['get'] } },
				default: '',
				description: 'The slideshow_id returned by Slideshow -> Create',
			},

			// Post: Publish Slideshow fields --------------------------------
			{
				displayName: 'Account IDs',
				name: 'accountIds',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['post'], operation: ['publishSlideshow'] } },
				default: '',
				placeholder: 'acc_123, acc_456',
				description:
					'Comma-separated TikTok, Instagram, Facebook or LinkedIn account IDs to post to. Use the Account Get Many operation to look them up.',
			},
			{
				displayName: 'Media Handles',
				name: 'mediaHandles',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['post'], operation: ['publishSlideshow'] } },
				default: '',
				placeholder: '={{ $json.media_handles }}',
				description:
					'The slides in order: map media_handles from Slideshow -> Create, or give comma-separated image handles',
			},
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['post'], operation: ['publishSlideshow'] } },
				typeOptions: { rows: 3 },
				default: '',
				description: 'Caption for the post (max 4000 characters)',
			},
			{
				displayName: 'Intent',
				name: 'intent',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['post'], operation: ['publishSlideshow'] } },
				default: '',
				description: 'One-line statement of why this post is happening (max 500 characters)',
			},
			{
				displayName: 'Plan ID',
				name: 'planId',
				type: 'string',
				displayOptions: { show: { resource: ['post'], operation: ['publishSlideshow'] } },
				default: '',
				placeholder: '3e4c8a4e-2f4b-4b6e-9a44-3a1a1c2d3e4f',
				description:
					'UUID of an approved plan this post claims, so it flows inside the plan without per-post review. Leave empty for a standalone post.',
			},
			{
				displayName: 'Agent Identity',
				name: 'agentIdentity',
				type: 'string',
				displayOptions: { show: { resource: ['post'], operation: ['publishSlideshow'] } },
				default: 'AI agent via n8n',
				description: 'Identity recorded on the post and shown to the human reviewer alongside the intent',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: { show: { resource: ['post'], operation: ['publishSlideshow'] } },
				default: {},
				options: [
					{
						displayName: 'AI Label',
						name: 'aiLabel',
						type: 'boolean',
						default: true,
						description:
							'Whether to mark the post as AI-generated on TikTok and Instagram. On unless you turn it off. Facebook and LinkedIn have no such setting.',
					},
					{
						displayName: 'Allow Comments (TikTok)',
						name: 'allowComments',
						type: 'boolean',
						default: false,
						description: 'Whether people can comment on the TikTok post. Other destinations ignore this.',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description:
							'Stable key to make retries safe. Leave empty to auto-generate a fresh key per execution.',
					},
					{
						displayName: 'LinkedIn Document Title',
						name: 'linkedinDocumentTitle',
						type: 'string',
						default: '',
						description:
							'Title LinkedIn shows on the carousel (max 200 characters). Leave empty to use the first line of the caption.',
					},
					{
						displayName: 'Publish At',
						name: 'publishAt',
						type: 'string',
						default: '',
						placeholder: '2026-09-01T09:00:00Z',
						description:
							'Schedule time as a UTC ISO 8601 timestamp ending in Z. Leave empty to publish now.',
					},
					{
						displayName: 'TikTok Auto-Add Music',
						name: 'tiktokAutoAddMusic',
						type: 'boolean',
						default: true,
						description: 'Whether TikTok adds one of its recommended tracks to the photo post. On unless you turn it off.',
					},
					{
						displayName: 'TikTok Commercial Content',
						name: 'tiktokCommercialContent',
						type: 'options',
						default: 'none',
						description:
							'TikTok content disclosure: whether the post promotes your own business or another brand. Other destinations ignore this.',
						options: [
							{ name: 'Another Brand (Paid Partnership)', value: 'brand_content' },
							{ name: 'None', value: 'none' },
							{ name: 'Your Own Brand', value: 'brand_organic' },
						],
					},
					{
						displayName: 'TikTok Privacy',
						name: 'tiktokPrivacy',
						type: 'options',
						default: 'PUBLIC_TO_EVERYONE',
						description: 'Who can see the slideshow on TikTok. Other destinations ignore this.',
						options: [
							{ name: 'Everyone', value: 'PUBLIC_TO_EVERYONE' },
							{ name: 'Followers', value: 'FOLLOWER_OF_CREATOR' },
							{ name: 'Friends', value: 'MUTUAL_FOLLOW_FRIENDS' },
							{ name: 'Only Me', value: 'SELF_ONLY' },
						],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('postdomApi');
		const baseUrl = normalizeBaseUrl(credentials.baseUrl as string | undefined);

		let cachedAccounts: PostdomAccount[] | undefined;
		const listConnectedAccounts = async (): Promise<PostdomAccount[]> => {
			if (cachedAccounts === undefined) {
				const response = await callPostdom(this, buildListAccounts(baseUrl));
				cachedAccounts = (response.accounts as PostdomAccount[] | undefined) ?? [];
			}
			return cachedAccounts;
		};

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			try {
				if (resource === 'workspace' && operation === 'getStatus') {
					returnData.push(toItem(await callPostdom(this, buildGetWorkspaceStatus(baseUrl)), i));
				} else if (resource === 'media' && operation === 'getStatus') {
					const response = await callPostdom(
						this,
						buildGetMediaStatus(baseUrl, this.getNodeParameter('mediaHandle', i) as string),
					);
					returnData.push(toItem({ ...parseMediaStatus(response) }, i));
				} else if (resource === 'media' && operation === 'upload') {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const binary = this.helpers.assertBinaryData(i, binaryPropertyName);
					const bytes = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
					const contentType = binary.mimeType as MediaContentType;
					if (!(MEDIA_CONTENT_TYPES as readonly string[]).includes(contentType)) {
						throw new NodeOperationError(
							this.getNode(),
							'The binary must be video/mp4 or video/quicktime',
							{ itemIndex: i },
						);
					}
					const createResponse = await callPostdom(
						this,
						buildCreateMediaUpload(baseUrl, {
							widthPixels: this.getNodeParameter('widthPixels', i) as number,
							heightPixels: this.getNodeParameter('heightPixels', i) as number,
							durationSeconds: this.getNodeParameter('durationSeconds', i) as number,
							contentType,
							sizeBytes: bytes.byteLength,
							platforms: this.getNodeParameter('platforms', i) as PostdomPlatform[],
						}, { node: this.getNode(), itemIndex: i }),
					);
					const contract = parseMediaUploadContract(
						createResponse,
						contentType,
						bytes.byteLength,
					);
					await putMediaDirect(this, buildDirectMediaPut(contract, bytes));

					if (!(this.getNodeParameter('waitForStorage', i) as boolean)) {
						returnData.push(toItem({ media_handle: contract.media_handle, status: 'pending' }, i));
						continue;
					}
					const status = await waitForMediaStorage(
						async () => {
							const response = await callPostdom(
								this,
								buildGetMediaStatus(baseUrl, contract.media_handle),
							);
							return parseMediaStatus(response);
						},
						{
							timeoutMs:
								(this.getNodeParameter('waitTimeoutSeconds', i) as number) * 1_000,
						},
					);
					returnData.push(toItem({ ...status }, i));
				} else if (resource === 'brief' && operation === 'get') {
					returnData.push(toItem(await callPostdom(this, buildGetBrief(baseUrl)), i));
				} else if (resource === 'digest' && operation === 'get') {
					returnData.push(toItem(await callPostdom(this, buildGetDigest(baseUrl)), i));
				} else if (resource === 'account' && operation === 'getAll') {
					const response = await callPostdom(this, buildListAccounts(baseUrl));
					const accounts = (response.accounts as IDataObject[] | undefined) ?? [];
					for (const account of accounts) returnData.push(toItem(account, i));
				} else if (resource === 'account' && operation === 'connect') {
					const request = buildConnectAccount(baseUrl, {
						platform: this.getNodeParameter('platform', i) as PostdomPlatform,
						redirectUrl: this.getNodeParameter('redirectUrl', i) as string,
					});
					returnData.push(toItem(await callPostdom(this, request), i));
				} else if (resource === 'account' && operation === 'getPerformance') {
					const request = buildGetAccountPerformance(
						baseUrl,
						this.getNodeParameter('accountId', i) as string,
						this.getNodeParameter('window', i) as PerformanceWindow,
					);
					returnData.push(toItem(await callPostdom(this, request), i));
				} else if (resource === 'account' && operation === 'getBestPosts') {
					const request = buildGetBestPosts(
						baseUrl,
						this.getNodeParameter('accountId', i) as string,
						this.getNodeParameter('metric', i) as PerformanceMetric,
						this.getNodeParameter('window', i) as PerformanceWindow,
					);
					returnData.push(toItem(await callPostdom(this, request), i));
				} else if (resource === 'plan' && operation === 'get') {
					const request = buildGetPlan(baseUrl, this.getNodeParameter('planId', i) as string);
					const response = await callPostdom(this, request);
					returnData.push(toItem(withN8nGuidance(response, planGuidance(response.status), { node: this.getNode(), itemIndex: i }), i));
				} else if (resource === 'plan' && operation === 'submit') {
					const additional = this.getNodeParameter('additionalFields', i) as IDataObject;
					const request = buildSubmitPlan(
						baseUrl,
						{
							accountIds: splitIds(this.getNodeParameter('accountIds', i) as string),
							title: this.getNodeParameter('title', i) as string,
							objective: this.getNodeParameter('objective', i) as string,
							startsAt: this.getNodeParameter('startsAt', i) as string,
							endsAt: this.getNodeParameter('endsAt', i) as string,
							maxPosts: this.getNodeParameter('maxPosts', i) as number,
							intent: this.getNodeParameter('intent', i) as string,
							agentIdentity: optionalString(this.getNodeParameter('agentIdentity', i)),
							briefVersion: optionalNumber(additional.briefVersion),
							idempotencyKey: optionalString(additional.idempotencyKey),
						},
						await listConnectedAccounts(),
					);
					const response = await callPostdom(this, request);
					returnData.push(toItem(withN8nGuidance(response, planGuidance(response.status), { node: this.getNode(), itemIndex: i }), i));
				} else if (resource === 'post' && operation === 'get') {
					const request = buildGetPost(baseUrl, this.getNodeParameter('postId', i) as string);
					const response = await callPostdom(this, request);
					returnData.push(toItem(withN8nGuidance(response, publishGuidance(response.status), { node: this.getNode(), itemIndex: i }), i));
				} else if (resource === 'post' && operation === 'getPerformance') {
					const request = buildGetPostPerformance(
						baseUrl,
						this.getNodeParameter('postId', i) as string,
					);
					returnData.push(toItem(await callPostdom(this, request), i));
				} else if (resource === 'post' && operation === 'publishVideo') {
					const additional = this.getNodeParameter('additionalFields', i) as IDataObject;
					const videoSource = this.getNodeParameter('videoSource', i) as string;
					const request = buildPublishVideo(
						baseUrl,
						{
							accountIds: splitIds(this.getNodeParameter('accountIds', i) as string),
							videoUrl:
								videoSource === 'videoUrl'
									? (this.getNodeParameter('videoUrl', i) as string)
									: undefined,
							mediaHandle:
								videoSource === 'mediaHandle'
									? (this.getNodeParameter('mediaHandle', i) as string)
									: undefined,
							caption: this.getNodeParameter('caption', i) as string,
							intent: this.getNodeParameter('intent', i) as string,
							agentIdentity: optionalString(this.getNodeParameter('agentIdentity', i)),
							publishAt: optionalString(additional.publishAt),
							planId: optionalString(this.getNodeParameter('planId', i)),
							idempotencyKey: optionalString(additional.idempotencyKey),
							tiktokPrivacy: optionalString(additional.tiktokPrivacy),
							allowComments: optionalBoolean(additional.allowComments),
							aiLabel: optionalBoolean(additional.aiLabel),
							tiktokCommercialContent: optionalString(additional.tiktokCommercialContent),
							youtubeVisibility: optionalString(additional.youtubeVisibility),
							youtubeTitle: optionalString(additional.youtubeTitle),
						},
						await listConnectedAccounts(),
					);
					const response = await callPostdom(this, request);
					returnData.push(toItem(withN8nGuidance(response, publishGuidance(response.status), { node: this.getNode(), itemIndex: i }), i));
				} else if (resource === 'media' && operation === 'uploadImageFromUrl') {
					const imageUrl = (this.getNodeParameter('imageUrl', i) as string).trim();
					const bytes = await downloadImage(this, imageUrl, i);
					const info = readImageInfo(bytes);
					if (!info) {
						throw new NodeOperationError(
							this.getNode(),
							'The file at Image URL is not a PNG, JPEG, GIF or WebP image',
							{ itemIndex: i },
						);
					}
					const createResponse = await callPostdom(
						this,
						buildCreateImageUpload(baseUrl, {
							contentType: info.contentType,
							sizeBytes: bytes.byteLength,
							widthPixels: info.width,
							heightPixels: info.height,
						}),
					);
					const contract = parseMediaUploadContract(createResponse, info.contentType, bytes.byteLength);
					await putMediaDirect(this, buildDirectMediaPut(contract, bytes));
					const measured = { width_pixels: info.width, height_pixels: info.height };
					if (!(this.getNodeParameter('waitForStorage', i) as boolean)) {
						returnData.push(
							toItem({ media_handle: contract.media_handle, status: 'pending', content_type: info.contentType, ...measured }, i),
						);
						continue;
					}
					const status = await waitForMediaStorage(
						async () => parseMediaStatus(await callPostdom(this, buildGetMediaStatus(baseUrl, contract.media_handle))),
						{ timeoutMs: (this.getNodeParameter('waitTimeoutSeconds', i) as number) * 1_000 },
					);
					returnData.push(toItem({ ...status, ...measured }, i));
				} else if (resource === 'slideshow' && operation === 'create') {
					const additional = this.getNodeParameter('additionalFields', i) as IDataObject;
					const slidesInput = this.getNodeParameter('slidesInput', i) as string;
					let slides: Array<Record<string, unknown>>;
					if (slidesInput === 'json') {
						slides = parseSlides(this.getNodeParameter('slidesJson', i));
					} else {
						const options = this.getNodeParameter('slideOptions', i) as IDataObject;
						slides = buildSimpleSlides({
							title: this.getNodeParameter('title', i) as string,
							points: this.getNodeParameter('points', i) as string,
							cta: optionalString(this.getNodeParameter('cta', i)),
							kicker: optionalString(options.kicker),
							coverImageHandle: optionalString(options.coverImageHandle),
							pointsStyle: options.pointsStyle === 'steps' ? 'steps' : 'list',
							pointsTitle: optionalString(options.pointsTitle),
							handle: optionalString(options.handle),
						});
					}
					const created = await callSlideshow(
						this,
						buildCreateSlideshow(baseUrl, {
							size: this.getNodeParameter('size', i) as string,
							slides,
							design: optionalString(additional.design),
							idempotencyKey: optionalString(additional.idempotencyKey),
						}),
						i,
					);
					let slideshow: Record<string, unknown> = created;
					if (created.status === 'rendering' && (this.getNodeParameter('waitForReady', i) as boolean)) {
						const slideshowId = String(created.slideshow_id);
						slideshow = await waitForSlideshow(
							async () => callSlideshow(this, buildGetSlideshow(baseUrl, slideshowId), i),
							created,
							{ timeoutMs: (this.getNodeParameter('waitTimeoutSeconds', i) as number) * 1_000 },
						);
					}
					returnData.push(toItem(withSlideshowHandles(slideshow) as IDataObject, i));
				} else if (resource === 'slideshow' && operation === 'get') {
					const request = buildGetSlideshow(baseUrl, this.getNodeParameter('slideshowId', i) as string);
					returnData.push(toItem(withSlideshowHandles(await callPostdom(this, request)) as IDataObject, i));
				} else if (resource === 'post' && operation === 'publishSlideshow') {
					const additional = this.getNodeParameter('additionalFields', i) as IDataObject;
					const request = buildPublishSlideshow(
						baseUrl,
						{
							accountIds: splitIds(this.getNodeParameter('accountIds', i) as string),
							mediaHandles: splitMediaHandles(this.getNodeParameter('mediaHandles', i)),
							caption: this.getNodeParameter('caption', i) as string,
							intent: this.getNodeParameter('intent', i) as string,
							agentIdentity: optionalString(this.getNodeParameter('agentIdentity', i)),
							planId: optionalString(this.getNodeParameter('planId', i)),
							publishAt: optionalString(additional.publishAt),
							idempotencyKey: optionalString(additional.idempotencyKey),
							tiktokPrivacy: optionalString(additional.tiktokPrivacy),
							allowComments: optionalBoolean(additional.allowComments),
							aiLabel: optionalBoolean(additional.aiLabel),
							tiktokCommercialContent: optionalString(additional.tiktokCommercialContent),
							tiktokAutoAddMusic: optionalBoolean(additional.tiktokAutoAddMusic),
							linkedinDocumentTitle: optionalString(additional.linkedinDocumentTitle),
						},
						await listConnectedAccounts(),
					);
					const response = await callPostdom(this, request);
					returnData.push(toItem(withN8nGuidance(response, publishGuidance(response.status), { node: this.getNode(), itemIndex: i }), i));
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for resource "${resource}"`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

async function putMediaDirect(
	context: IExecuteFunctions,
	request: DirectMediaPutRequest,
): Promise<void> {
	const options: IHttpRequestOptions = {
		method: request.method,
		url: request.url,
		headers: request.headers,
		body: request.body,
	};
	await context.helpers.httpRequest(options);
}

async function callPostdom(
	context: IExecuteFunctions,
	request: PostdomRequest,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method: request.method,
		url: request.url,
		headers: request.headers,
		json: true,
	};
	if (request.body !== undefined) options.body = request.body;
	return (await context.helpers.httpRequestWithAuthentication.call(
		context,
		'postdomApi',
		options,
	)) as IDataObject;
}

function toItem(json: IDataObject, itemIndex: number): INodeExecutionData {
	return { json, pairedItem: { item: itemIndex } };
}

function splitIds(raw: string): string[] {
	return raw
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value !== '');
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

/**
 * Downloads an image for Upload Image From URL. Plain `httpRequest`: the Postdom credential is
 * never sent to a third-party URL.
 */
async function downloadImage(context: IExecuteFunctions, url: string, itemIndex: number): Promise<Buffer> {
	try {
		new URL(url);
	} catch {
		throw new NodeOperationError(context.getNode(), 'Image URL must be a valid URL', { itemIndex });
	}
	const body = (await context.helpers.httpRequest({
		method: 'GET',
		url,
		encoding: 'arraybuffer',
		json: false,
	})) as ArrayBuffer | Buffer;
	const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
	if (bytes.byteLength < 1 || bytes.byteLength > MEDIA_MAX_BYTES) {
		throw new NodeOperationError(
			context.getNode(),
			`The image must be between 1 and ${MEDIA_MAX_BYTES} bytes`,
			{ itemIndex },
		);
	}
	return bytes;
}

/**
 * A slideshow create or read, keeping the API's answer when it is a refusal: a slide that does
 * not fit (422) names each field, and a busy workspace (429) says to wait. Those become one
 * readable node error instead of a bare status code.
 */
async function callSlideshow(
	context: IExecuteFunctions,
	request: PostdomRequest,
	itemIndex: number,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method: request.method,
		url: request.url,
		headers: request.headers,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (request.body !== undefined) options.body = request.body;
	const response = (await context.helpers.httpRequestWithAuthentication.call(
		context,
		'postdomApi',
		options,
	)) as { statusCode?: number; body?: unknown };
	const status = response.statusCode ?? 0;
	const body = (typeof response.body === 'object' && response.body !== null ? response.body : {}) as IDataObject;
	if (status >= 200 && status < 300) {
		if (body.status === 'refused' || body.status === 'failed') {
			throw new NodeOperationError(
				context.getNode(),
				body.status === 'refused'
					? slideshowRefusalMessage(body)
					: `Slideshow ${String(body.slideshow_id)} failed: ${String(body.failure_reason ?? 'not rendered')}`,
				{ itemIndex },
			);
		}
		return body;
	}
	const detail = typeof body.detail === 'string' ? body.detail : `HTTP ${status}`;
	if (status === 422 && body.code === 'slides_do_not_fit') {
		throw new NodeOperationError(context.getNode(), slideshowRefusalMessage(body), { itemIndex, description: detail });
	}
	throw new NodeOperationError(
		context.getNode(),
		`Postdom did not render the slideshow (${status}): ${detail}`,
		{ itemIndex },
	);
}
