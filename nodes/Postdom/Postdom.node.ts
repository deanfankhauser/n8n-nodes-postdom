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
	CONNECT_DESTINATIONS,
	destinationOptions,
	MEDIA_CONTENT_TYPES,
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
			'Upload media, publish short-form video, submit bounded publication plans, and read performance from a Postdom workspace',
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
						name: 'Publish Video',
						value: 'publishVideo',
						action: 'Publish a video',
						description:
							'Create a short-form video publish with each provider\'s supported safety defaults, optionally scheduled in UTC. Posts flow automatically inside an account\'s policy or await review on review-mode accounts; landing in review is a success state, never an error.',
					},
				],
				default: 'get',
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
