import type {
	IDataObject,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import type { PolledPostStatus, PostdomRequest } from '../Postdom/PostdomRequests';
import {
	buildGetPost,
	isTerminalPostStatus,
	normalizeBaseUrl,
	publishOutcome,
	selectTerminalEmissions,
	TERMINAL_POST_STATUSES,
} from '../Postdom/PostdomRequests';

interface TriggerStaticData {
	emitted?: Record<string, string>;
}

export class PostdomTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Postdom Trigger',
		name: 'postdomTrigger',
		icon: { light: 'file:postdom.svg', dark: 'file:postdom.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: 'Post Status',
		description:
			'Starts the workflow when a watched Postdom post reaches a terminal publish state (published, partial, failed, rejected, missed approval, or missed schedule)',
		defaults: {
			name: 'Postdom Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'postdomApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Trigger On',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Post Status',
						value: 'postStatus',
						description:
							'A watched post reached a terminal state: published, partial, failed, rejected, missed approval, or missed schedule',
					},
				],
				default: 'postStatus',
			},
			{
				displayName: 'Post IDs',
				name: 'postIds',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'post_123, post_456',
				description:
					'Comma-separated IDs of the posts to watch, as returned by Publish Video. Agent credentials read posts one by one; Postdom has no agent-scope list-posts endpoint yet, so each watched ID is polled individually. Each post fires once per terminal state; in-flight states (draft, requires approval, changes requested, scheduled, publishing) never fire.',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const credentials = await this.getCredentials('postdomApi');
		const baseUrl = normalizeBaseUrl(credentials.baseUrl as string | undefined);
		const postIds = splitIds(this.getNodeParameter('postIds') as string);
		if (postIds.length === 0) {
			if (this.getMode() === 'manual') {
				throw new NodeOperationError(this.getNode(), 'Add at least one post ID to watch');
			}
			return null;
		}

		const isManual = this.getMode() === 'manual';
		const polled: PolledPostStatus[] = [];
		const snapshots = new Map<string, IDataObject>();
		for (const postId of postIds) {
			let post: IDataObject;
			try {
				post = await callPostdom(this, buildGetPost(baseUrl, postId));
			} catch (error) {
				// Surface problems while testing; in production keep polling the
				// remaining posts and retry this one on the next tick.
				if (isManual) {
					throw error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error);
				}
				continue;
			}
			const status = typeof post.status === 'string' ? post.status : 'unknown';
			polled.push({ postId, status });
			snapshots.set(postId, post);
		}

		if (isManual) {
			// Manual executions emit the current snapshot of every watched post,
			// terminal or not, so the workflow can be built against real data.
			const sample = polled.map(({ postId }) => toTriggerItem(snapshots.get(postId)!));
			return sample.length > 0 ? [sample] : null;
		}

		const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
		const { emit, nextEmitted } = selectTerminalEmissions(polled, staticData.emitted ?? {});
		staticData.emitted = nextEmitted;
		if (emit.length === 0) return null;
		return [emit.map(({ postId }) => toTriggerItem(snapshots.get(postId)!))];
	}
}

function toTriggerItem(post: IDataObject): INodeExecutionData {
	const status = post.status;
	return {
		json: {
			...post,
			event: 'postStatus',
			terminal: isTerminalPostStatus(status),
			terminal_states: [...TERMINAL_POST_STATUSES],
			outcome: publishOutcome(status),
		},
	};
}

async function callPostdom(context: IPollFunctions, request: PostdomRequest): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method: request.method,
		url: request.url,
		headers: request.headers,
		json: true,
	};
	return (await context.helpers.httpRequestWithAuthentication.call(
		context,
		'postdomApi',
		options,
	)) as IDataObject;
}

function splitIds(raw: string): string[] {
	return raw
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value !== '');
}
