import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IDataObject, IExecuteFunctions, IPollFunctions, IHttpRequestOptions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { Postdom } from '../nodes/Postdom/Postdom.node';
import { PostdomTrigger } from '../nodes/PostdomTrigger/PostdomTrigger.node';
import { planGuidance, publishGuidance, withN8nGuidance } from '../nodes/Postdom/PostdomRequests';

// Include unknown future evidence, all availability states, and meaningful nulls.
const evidence = {
	observed_at: '2026-08-31T02:30:09Z',
	posts: {
		published: { value: 1, availability: { state: 'available', reason: null, observed_at: '2026-08-31T02:30:09Z', source: 'posts' } },
	},
	top_post: { value: null, availability: { state: 'unavailable', reason: 'no_metric_snapshots', observed_at: null, source: 'metric_snapshots' } },
	aggregates: {
		views: { value: { value: 42, availability: { state: 'partial', reason: 'incomplete_coverage', observed_at: null, source: 'metric_snapshots' } } },
	},
	future_evidence: { value: null, raw: [0, false, ''] },
};

const TEST_NODE = {
	id: 'postdom-guidance-test-node',
	name: 'Postdom',
	type: 'n8n-nodes-postdom.postdom',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
} as INode;

async function execute(resource: string, operation: string, response: IDataObject) {
	const parameters: Record<string, unknown> = {
		resource, operation, postId: 'post-fixture', planId: 'plan-fixture',
		accountIds: 'fixture', title: 'Contract fixture', objective: 'Verify preservation',
		startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-09-02T00:00:00Z',
		maxPosts: 1, intent: 'Verify evidence preservation', agentIdentity: 'offline-test',
		additionalFields: {}, videoSource: 'videoUrl', videoUrl: 'https://example.invalid/video.mp4',
		caption: 'Offline fixture',
	};
	const context = {
		getInputData: () => [{ json: {} }],
		getCredentials: async () => ({}),
		getNodeParameter: (name: string) => parameters[name],
		getNode: () => TEST_NODE,
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (_credential: string, request: IHttpRequestOptions) =>
				request.url.endsWith('/v1/accounts')
					? { accounts: [{ providerAccountId: 'fixture', platform: 'youtube' }] }
					: response,
		},
	} as unknown as IExecuteFunctions;
	return (await new Postdom().execute.call(context))[0]![0]!.json;
}

describe('n8n guidance never replaces API evidence', () => {
	for (const [resource, operation] of [['plan', 'get'], ['plan', 'submit'], ['post', 'get'], ['post', 'publishVideo']] as const) {
		it.each([evidence, null])(`${resource} ${operation} preserves the complete server outcome (%j)`, async (outcome) => {
			const response = { id: 'fixture', status: 'requires_approval', outcome, future_field: { nested: null } };
			const before = JSON.stringify(response);
			const output = await execute(resource, operation, response);
			expect(output.outcome).toBe(outcome);
			expect(JSON.stringify(output.outcome)).toBe(JSON.stringify(outcome));
			expect(output.future_field).toStrictEqual(response.future_field);
			expect(output.postdom_n8n_guidance).toStrictEqual(
				(resource === 'plan' ? planGuidance : publishGuidance)(response.status),
			);
			expect(JSON.stringify(response)).toBe(before);
		});
	}

	it.each(['get', 'publishVideo'])('post %s does not invent a server outcome', async (operation) => {
		const output = await execute('post', operation, { id: 'fixture', status: 'scheduled' });
		expect(output).not.toHaveProperty('outcome');
		expect(output).toHaveProperty('postdom_n8n_guidance');
	});

	it.each(['manual', 'trigger'])('preserves evidence in %s polling emissions', async (mode) => {
		const response = { id: 'fixture', status: 'published', outcome: evidence };
		const context = {
			getCredentials: async () => ({}),
			getNodeParameter: () => 'fixture',
			getMode: () => mode,
			getNode: () => TEST_NODE,
			getWorkflowStaticData: () => ({}),
			helpers: { httpRequestWithAuthentication: async () => response },
		} as unknown as IPollFunctions;
		const output = (await new PostdomTrigger().poll.call(context))?.[0]?.[0]?.json;
		expect(output?.outcome).toBe(evidence);
		expect(output?.postdom_n8n_guidance).toStrictEqual(publishGuidance('published'));
		expect(output?.terminal).toBe(true);
	});

	it('fails visibly if a future API field occupies the reserved namespace', () => {
		const addGuidance = () => withN8nGuidance(
			{ postdom_n8n_guidance: evidence },
			publishGuidance('published'),
			{ node: TEST_NODE },
		);
		expect(addGuidance).toThrowError(NodeOperationError);
		expect(addGuidance).toThrow('reserved postdom_n8n_guidance');
	});

	it('does not mark a trigger item delivered when namespace preservation fails', async () => {
		const staticData = {};
		const context = {
			getCredentials: async () => ({}),
			getNodeParameter: () => 'fixture',
			getMode: () => 'trigger',
			getNode: () => TEST_NODE,
			getWorkflowStaticData: () => staticData,
			helpers: { httpRequestWithAuthentication: async () => ({
				id: 'fixture', status: 'published', postdom_n8n_guidance: evidence,
			}) },
		} as unknown as IPollFunctions;
		await expect(new PostdomTrigger().poll.call(context)).rejects.toThrow('reserved postdom_n8n_guidance');
		expect(staticData).toStrictEqual({});
	});

	it('all shipped template guidance expressions use the namespace, never API outcome', () => {
		const directory = join(__dirname, '../templates');
		let guidanceTemplates = 0;
		for (const name of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
			const text = readFileSync(join(directory, name), 'utf8');
			expect(() => JSON.parse(text)).not.toThrow();
			expect(text).not.toMatch(/(?:\.outcome|\[['"]outcome['"]\])(?:\.|\[)/);
			if (text.includes('postdom_n8n_guidance')) guidanceTemplates++;
		}
		expect(guidanceTemplates).toBe(5);
	});
});
