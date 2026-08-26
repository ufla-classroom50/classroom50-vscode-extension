import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

interface ExtensionConfig {
    'assignment-name': string;
    'polling-interval-minutes': number;
}

function loadConfig(): ExtensionConfig | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('Classroom 50: nenhuma pasta aberta no workspace.');
        return undefined;
    }

    const configPath = path.join(workspaceFolders[0].uri.fsPath, '.c50extension.yaml');

    if (!fs.existsSync(configPath)) {
        vscode.window.showErrorMessage('Classroom 50: arquivo .c50extension.yaml não encontrado.');
        return undefined;
    }

    const fileContents = fs.readFileSync(configPath, 'utf8');
    return yaml.load(fileContents) as ExtensionConfig;
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

export async function activate(context: vscode.ExtensionContext) {
    console.log('Classroom 50 extension is now active!');

    const session = await getGitHubSession();
    if (!session) {
        vscode.window.showErrorMessage('Classroom 50: não foi possível autenticar com o GitHub.');
        return;
    }

    const config = loadConfig();
    if (!config) {
        return;
    }

    vscode.window.showInformationMessage(
        `Classroom 50: autenticado como ${session.account.label} — ${config['assignment-name']}`
    );
}

export function deactivate() {}