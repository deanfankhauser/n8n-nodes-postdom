import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { INodePropertyOptions } from 'n8n-workflow';

import { Postdom } from '../nodes/Postdom/Postdom.node';

/**
 * Import-validity tests for the workflow templates: every file must parse as a
 * valid n8n workflow export (nodes + connections), reference the Postdom
 * package nodes by their real type names, and only use resource/operation
 * pairs the node actually implements.
 */

// vitest runs from the package root (integrations/n8n)
const TEMPLATES_DIR = join(process.cwd(), 'templates');
const PACKAGE_NAME = 'n8n-nodes-postdom';
const ACTION_NODE_TYPE = `${PACKAGE_NAME}.postdom`;
const TRIGGER_NODE_TYPE = `${PACKAGE_NAME}.postdomTrigger`;
const TRIGGER_TYPES = new Set([
	TRIGGER_NODE_TYPE,
	'n8n-nodes-base.manualTrigger',
	'n8n-nodes-base.scheduleTrigger',
]);
const SIDECAR_NODE_TYPES = new Set(['@n8n/n8n-nodes-langchain.lmChatOpenAi']);

interface TemplateNode {
	parameters: Record<string, unknown>;
	id: string;
	name: string;
	type: string;
	typeVersion: number;
	position: [number, number];
	credentials?: Record<string, unknown>;
}

interface TemplateWorkflow {
	name: string;
	nodes: TemplateNode[];
	connections: Record<string, { main?: Array<Array<{ node: string; type: string; index: number }>> }>;
	pinData?: Record<string, unknown>;
	settings?: Record<string, unknown>;
}

const files = readdirSync(TEMPLATES_DIR).filter((file) => file.endsWith('.json'));
const workflows = new Map<string, TemplateWorkflow>(
	files.map((file) => [
		file,
		JSON.parse(readFileSync(join(TEMPLATES_DIR, file), 'utf8')) as TemplateWorkflow,
	]),
);

function validOperations(): Map<string, Set<string>> {
	const description = new Postdom().description;
	const matrix = new Map<string, Set<string>>();
	for (const property of description.properties) {
		if (property.name !== 'operation') continue;
		const resources = (property.displayOptions?.show?.resource as string[] | undefined) ?? [];
		const operations = (property.options as INodePropertyOptions[]).map(
			(option) => option.value as string,
		);
		for (const resource of resources) matrix.set(resource, new Set(operations));
	}
	return matrix;
}

describe('workflow templates', () => {
	it('ships at least three importable templates', () => {
		expect(files.length).toBeGreaterThanOrEqual(3);
	});

	it('covers media upload, publish-and-wait, plan-first, digest-notify, and the trigger', () => {
		const allNodes = [...workflows.values()].flatMap((workflow) => workflow.nodes);
		const operationsUsed = allNodes
			.filter((node) => node.type === ACTION_NODE_TYPE)
			.map((node) => `${node.parameters.resource as string}.${node.parameters.operation as string}`);
		expect(operationsUsed).toContain('post.publishVideo');
		expect(operationsUsed).toContain('media.upload');
		expect(operationsUsed).toContain('plan.submit');
		expect(operationsUsed).toContain('plan.get');
		expect(operationsUsed).toContain('post.get');
		expect(operationsUsed).toContain('post.getPerformance');
		expect(operationsUsed).toContain('digest.get');
		expect(allNodes.some((node) => node.type === TRIGGER_NODE_TYPE)).toBe(true);
	});

	for (const [file, workflow] of workflows) {
		describe(file, () => {
			it('has the n8n workflow export shape', () => {
				expect(typeof workflow.name).toBe('string');
				expect(workflow.name.length).toBeGreaterThan(0);
				expect(Array.isArray(workflow.nodes)).toBe(true);
				expect(workflow.nodes.length).toBeGreaterThan(0);
				expect(typeof workflow.connections).toBe('object');
			});

			it('gives every node an id, unique name, type, typeVersion, and position', () => {
				const names = new Set<string>();
				const ids = new Set<string>();
				for (const node of workflow.nodes) {
					expect(typeof node.id).toBe('string');
					expect(node.id.length).toBeGreaterThan(0);
					expect(ids.has(node.id)).toBe(false);
					ids.add(node.id);
					expect(typeof node.name).toBe('string');
					expect(names.has(node.name)).toBe(false);
					names.add(node.name);
					expect(typeof node.type).toBe('string');
					expect(typeof node.typeVersion).toBe('number');
					expect(Array.isArray(node.position)).toBe(true);
					expect(node.position).toHaveLength(2);
					for (const coordinate of node.position) expect(typeof coordinate).toBe('number');
					expect(typeof node.parameters).toBe('object');
				}
			});

			it('references the Postdom package by its real node type names', () => {
				const postdomNodes = workflow.nodes.filter((node) =>
					node.type.startsWith(`${PACKAGE_NAME}.`),
				);
				expect(postdomNodes.length).toBeGreaterThan(0);
				for (const node of postdomNodes) {
					expect([ACTION_NODE_TYPE, TRIGGER_NODE_TYPE]).toContain(node.type);
				}
			});

			it('only uses resource/operation pairs the Postdom node implements', () => {
				const matrix = validOperations();
				for (const node of workflow.nodes) {
					if (node.type !== ACTION_NODE_TYPE) continue;
					const resource = node.parameters.resource as string;
					const operation = node.parameters.operation as string;
					expect(matrix.has(resource)).toBe(true);
					expect(matrix.get(resource)!.has(operation)).toBe(true);
				}
			});

			it('wires every connection to an existing node', () => {
				const names = new Set(workflow.nodes.map((node) => node.name));
				for (const [source, outputs] of Object.entries(workflow.connections)) {
					expect(names.has(source)).toBe(true);
					for (const branch of outputs.main ?? []) {
						for (const target of branch) {
							expect(names.has(target.node)).toBe(true);
							expect(target.type).toBe('main');
							expect(typeof target.index).toBe('number');
						}
					}
				}
			});

			it('starts from exactly one trigger node', () => {
				const triggers = workflow.nodes.filter((node) => TRIGGER_TYPES.has(node.type));
				expect(triggers).toHaveLength(1);
			});

			it('reaches every non-trigger node from the trigger', () => {
				const adjacency = new Map<string, string[]>();
				for (const [source, outputs] of Object.entries(workflow.connections)) {
					adjacency.set(
						source,
						(outputs.main ?? []).flat().map((target) => target.node),
					);
				}
				const [start] = workflow.nodes.filter((node) => TRIGGER_TYPES.has(node.type));
				const visited = new Set<string>([start!.name]);
				const queue = [start!.name];
				while (queue.length > 0) {
					for (const next of adjacency.get(queue.shift()!) ?? []) {
						if (visited.has(next)) continue;
						visited.add(next);
						queue.push(next);
					}
				}
				for (const node of workflow.nodes) {
					if (SIDECAR_NODE_TYPES.has(node.type)) continue;
					expect(visited.has(node.name)).toBe(true);
				}
			});

			it('embeds no credential IDs, so imports never point at foreign credentials', () => {
				for (const node of workflow.nodes) {
					expect(node.credentials).toBeUndefined();
				}
			});

			it('gives the Postdom trigger poll times and watched post IDs', () => {
				for (const node of workflow.nodes) {
					if (node.type !== TRIGGER_NODE_TYPE) continue;
					expect(node.parameters.pollTimes).toBeDefined();
					expect(typeof node.parameters.postIds).toBe('string');
					expect((node.parameters.postIds as string).length).toBeGreaterThan(0);
				}
			});
		});
	}
});
