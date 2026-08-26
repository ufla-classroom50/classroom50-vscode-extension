import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	console.log('Classroom 50 extension is now active!');

	const session = await getGitHubSession();


	async function getGitHubSession(): Promise<vscode.AuthenticationSession> | undefined {
		try {
			return await vscode.authentication.getSession(
				'github',
				['repo'],
				{ createIfNone: true }
			);
		} catch {
			return undefined;
		}
	}
	
}

export function deactivate() {}
