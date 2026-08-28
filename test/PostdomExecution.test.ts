import { describe, expect, it, vi } from 'vitest';

import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';

import { Postdom } from '../nodes/Postdom/Postdom.node';

const MEDIA_HANDLE = 'pd_media_11111111-1111-4111-8111-111111111111';
const UPLOAD_URL = 'https://r2.example.test/workspaces/org/uploads/video.mp4?signed=once';

describe('Postdom media upload execution', () => {
	it('keeps Postdom auth off the binary PUT and keeps the signed URL out of output', async () => {
		const parameters: Record<string, unknown> = {
			resource: 'media',
			operation: 'upload',
			binaryPropertyName: 'data',
			platforms: ['tiktok'],
			waitForStorage: true,
			waitTimeoutSeconds: 5,
		};
		const authenticatedRequests: IHttpRequestOptions[] = [];
		const directRequests: IHttpRequestOptions[] = [];
		const authenticated = vi.fn(
			async (_credentialName: string, options: IHttpRequestOptions): Promise<IDataObject> => {
				authenticatedRequests.push(options);
				if (options.method === 'POST') {
					return {
						media_handle: MEDIA_HANDLE,
						upload_url: UPLOAD_URL,
						method: 'PUT',
						headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' },
						expires_at: new Date(Date.now() + 60_000).toISOString(),
					};
				}
				return {
					media_handle: MEDIA_HANDLE,
					status: 'stored',
					content_type: 'video/mp4',
					size_bytes: 4,
					media_url: 'https://media.example.test/video.mp4',
					failure_reason: null,
				};
			},
		);
		const direct = vi.fn(async (options: IHttpRequestOptions): Promise<IDataObject> => {
			directRequests.push(options);
			return {};
		});

		const context = {
			getInputData: () => [{ json: {} }],
			getCredentials: async () => ({
				apiKey: 'pd_live_secret-never-forwarded',
				baseUrl: 'https://api.example.test',
			}),
			getNodeParameter: (name: string) => parameters[name],
			getNode: () => ({ name: 'Postdom', type: 'postdom', typeVersion: 1, position: [0, 0] }),
			continueOnFail: () => false,
			helpers: {
				assertBinaryData: () => ({ mimeType: 'video/mp4' }),
				getBinaryDataBuffer: async () => Buffer.from([1, 2, 3, 4]),
				httpRequestWithAuthentication: authenticated,
				httpRequest: direct,
			},
		} as unknown as IExecuteFunctions;

		const output = await new Postdom().execute.call(context);

		expect(authenticated).toHaveBeenCalledTimes(2);
		expect(authenticatedRequests.map((request) => request.url)).toStrictEqual([
			'https://api.example.test/v1/media/uploads',
			`https://api.example.test/v1/media/${MEDIA_HANDLE}`,
		]);
		expect(direct).toHaveBeenCalledTimes(1);
		expect(directRequests[0]).toStrictEqual({
			method: 'PUT',
			url: UPLOAD_URL,
			headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' },
			body: Buffer.from([1, 2, 3, 4]),
		});
		expect(directRequests[0]?.headers).not.toHaveProperty('Authorization');
		expect(directRequests[0]?.headers).not.toHaveProperty('X-Postdom-Source');
		expect(JSON.stringify(output)).not.toContain(UPLOAD_URL);
		expect(output[0]?.[0]?.json).toMatchObject({
			media_handle: MEDIA_HANDLE,
			status: 'stored',
		});
	});
});
