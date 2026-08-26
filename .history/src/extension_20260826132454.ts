import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';

interface ExtensionConfig {
    'assignment-name': string;
    'polling-interval-minutes': number;
}

interface RepoInfo {
    org: string;
    repo: string;
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

function parseGitRemote(): RepoInfo | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return undefined;
    }

    try {
        const cwd = workspaceFolders[0].uri.fsPath;
        const remoteUrl = execSync('git remote get-url origin', { cwd }).toString().trim();
        const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/);
        const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(\.git)?$/);

        const match = httpsMatch || sshMatch;
        if (!match) {
            vscode.window.showErrorMessage('Classroom 50: não foi possível identificar o repositório GitHub.');
            return undefined;
        }

        return { org: match[1], repo: match[2] };
    } catch {
        vscode.window.showErrorMessage('Classroom 50: pasta aberta não é um repositório git.');
        return undefined;
    }
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

    const repoInfo = parseGitRemote();
    if (!repoInfo) {
        return;
    }

    vscode.window.showInformationMessage(
        `Classroom 50: ${config['assignment-name']} | ${repoInfo.org}/${repoInfo.repo}`
    );
}

export function deactivate() {}