import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class PostdomApi implements ICredentialType {
	name = 'postdomApi';

	displayName = 'Postdom API';

	documentationUrl = 'https://postdom.com/docs';

	icon: Icon = {
		light: 'file:../nodes/Postdom/postdom.svg',
		dark: 'file:../nodes/Postdom/postdom.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Workspace agent key starting with pd_live_. A human creates it in the Postdom dashboard under Accounts, in the Agent keys section. Keys carry read and write scopes; write operations require the write scope.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.postdom.com',
			description:
				'Postdom API origin without a trailing slash. Keep the default unless Postdom directs you to a different environment.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{ $credentials.baseUrl.endsWith("/") ? $credentials.baseUrl.slice(0, -1) : $credentials.baseUrl }}',
			url: '/v1/workspace/status',
		},
	};
}
