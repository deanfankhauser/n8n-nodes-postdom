import { describe, expect, it } from 'vitest';

import type { INodeProperties, INodePropertyCollection, INodePropertyOptions } from 'n8n-workflow';

import { Postdom } from '../nodes/Postdom/Postdom.node';
import { PostdomTrigger } from '../nodes/PostdomTrigger/PostdomTrigger.node';

const postdom = new Postdom().description;
const trigger = new PostdomTrigger().description;

function operationProperty(resource: string): INodeProperties {
	const property = postdom.properties.find(
		(candidate) =>
			candidate.name === 'operation' &&
			(candidate.displayOptions?.show?.resource as string[] | undefined)?.includes(resource),
	);
	if (!property) throw new Error(`No operation property for resource ${resource}`);
	return property;
}

function operationValues(resource: string): string[] {
	const options = operationProperty(resource).options as INodePropertyOptions[];
	return options.map((option) => option.value as string);
}

function publishVideoProperties(): INodeProperties[] {
	return postdom.properties.filter(
		(candidate) =>
			(candidate.displayOptions?.show?.resource as string[] | undefined)?.includes('post') &&
			(candidate.displayOptions?.show?.operation as string[] | undefined)?.includes(
				'publishVideo',
			),
	);
}

function operationProperties(resource: string, operation: string): INodeProperties[] {
	return postdom.properties.filter(
		(candidate) =>
			(candidate.displayOptions?.show?.resource as string[] | undefined)?.includes(resource) &&
			(candidate.displayOptions?.show?.operation as string[] | undefined)?.includes(operation),
	);
}

describe('Postdom node description', () => {
	it('registers the credential and stays usable as an AI tool', () => {
		expect(postdom.name).toBe('postdom');
		expect(postdom.credentials).toStrictEqual([{ name: 'postdomApi', required: true }]);
		expect(postdom.usableAsTool).toBe(true);
	});

	it('names the account listing operation Get Many (n8n convention), not List', () => {
		const options = operationProperty('account').options as INodePropertyOptions[];
		const getMany = options.find((option) => option.value === 'getAll');
		expect(getMany?.name).toBe('Get Many');
		expect(operationProperty('account').default).toBe('getAll');
		expect(options.some((option) => option.value === 'list')).toBe(false);
		expect(options.some((option) => option.name === 'List')).toBe(false);
	});

	it('keeps the full operation matrix', () => {
		expect(operationValues('workspace')).toStrictEqual(['getStatus']);
		expect(operationValues('account').sort()).toStrictEqual(
			['connect', 'getAll', 'getBestPosts', 'getPerformance'].sort(),
		);
		expect(operationValues('plan').sort()).toStrictEqual(['get', 'submit'].sort());
		expect(operationValues('media').sort()).toStrictEqual(['getStatus', 'upload'].sort());
		expect(operationValues('post').sort()).toStrictEqual(
			['get', 'getPerformance', 'publishVideo'].sort(),
		);
		expect(operationValues('brief')).toStrictEqual(['get']);
		expect(operationValues('digest')).toStrictEqual(['get']);
	});

	it('uploads from an n8n binary property and exposes only bounded status controls', () => {
		const upload = operationProperties('media', 'upload');
		const binary = upload.find((property) => property.name === 'binaryPropertyName');
		const platforms = upload.find((property) => property.name === 'platforms');
		const wait = upload.find((property) => property.name === 'waitForStorage');
		const timeout = upload.find((property) => property.name === 'waitTimeoutSeconds');
		expect(binary?.required).toBe(true);
		expect(binary?.default).toBe('data');
		expect(platforms?.type).toBe('multiOptions');
		expect(wait?.default).toBe(true);
		expect(timeout?.typeOptions).toMatchObject({ minValue: 1, maxValue: 300 });
		expect(upload.some((property) => property.name === 'uploadUrl')).toBe(false);
	});

	it('makes URL versus media handle an explicit Publish Video choice', () => {
		const source = publishVideoProperties().find((property) => property.name === 'videoSource');
		const options = source?.options as INodePropertyOptions[];
		expect(options.map((option) => option.value)).toStrictEqual(['mediaHandle', 'videoUrl']);
		expect(source?.default).toBe('videoUrl');

		const videoUrl = publishVideoProperties().find((property) => property.name === 'videoUrl');
		const mediaHandle = publishVideoProperties().find((property) => property.name === 'mediaHandle');
		expect(videoUrl?.required).toBe(true);
		expect(mediaHandle?.required).toBe(true);
		expect(videoUrl?.displayOptions?.show?.videoSource).toStrictEqual(['videoUrl']);
		expect(mediaHandle?.displayOptions?.show?.videoSource).toStrictEqual(['mediaHandle']);
	});

	it('surfaces plan_id, intent, and agent_identity as prominent Publish Video fields', () => {
		const names = publishVideoProperties().map((property) => property.name);
		expect(names).toContain('intent');
		expect(names).toContain('planId');
		expect(names).toContain('agentIdentity');

		const planId = publishVideoProperties().find((property) => property.name === 'planId');
		expect(planId?.type).toBe('string');
		expect(planId?.description).toContain('Plan-first');

		const agentIdentity = publishVideoProperties().find(
			(property) => property.name === 'agentIdentity',
		);
		expect(agentIdentity?.default).toBe('AI agent via n8n');

		const additional = publishVideoProperties().find(
			(property) => property.name === 'additionalFields',
		);
		const buried = ((additional?.options ?? []) as Array<INodePropertyOptions | INodePropertyCollection>).map(
			(option) => option.name,
		);
		expect(buried).not.toContain('planId');
		expect(buried).not.toContain('agentIdentity');
	});

	it('documents honest metric availability on both performance operations', () => {
		for (const resource of ['account', 'post']) {
			const options = operationProperty(resource).options as INodePropertyOptions[];
			const performance = options.find((option) => option.value === 'getPerformance');
			expect(performance?.description).toContain('availability');
			expect(performance?.description).toContain('never');
			expect(performance?.description).toContain('unverified');
		}
	});
});

describe('PostdomTrigger node description', () => {
	it('is a polling trigger with no inputs and one main output', () => {
		expect(trigger.name).toBe('postdomTrigger');
		expect(trigger.group).toStrictEqual(['trigger']);
		expect(trigger.polling).toBe(true);
		expect(trigger.inputs).toStrictEqual([]);
		expect(trigger.outputs).toStrictEqual(['main']);
	});

	it('uses the same Postdom credential as the action node', () => {
		expect(trigger.credentials).toStrictEqual([{ name: 'postdomApi', required: true }]);
	});

	it('exposes the Post Status event and the watched post IDs', () => {
		const event = trigger.properties.find((property) => property.name === 'event');
		expect((event?.options as INodePropertyOptions[]).map((option) => option.value)).toStrictEqual([
			'postStatus',
		]);

		const postIds = trigger.properties.find((property) => property.name === 'postIds');
		expect(postIds?.required).toBe(true);
		expect(postIds?.type).toBe('string');
		expect(postIds?.description).toContain('no agent-scope list-posts endpoint');
	});

	it('implements poll, not execute', () => {
		const node = new PostdomTrigger();
		expect(typeof node.poll).toBe('function');
		expect('execute' in node).toBe(false);
	});
});
