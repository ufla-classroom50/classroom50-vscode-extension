import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Classroom 50 extension is now active!');

    const session = await getGitHubSession();

    if (!session) {
        vscode.window.showErrorMessage(
            'Classroom 50: nao foi possivel autenticar com o GitHub. Faca login para continuar.'
        );
        return;
    }

    vscode.window.showInformationMessage(
        `Classroom 50: autenticado como ${session.account.label}`
    );
}

async function getGitHubSession(): Promise<vscode.AuthenticationSession | undefined> {
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

export function deactivate() {}