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

interface GitHubComment {
    id: number;
    body: string;
    html_url: string;
    user: { login: string };
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

    return yaml.load(fs.readFileSync(configPath, 'utf8')) as ExtensionConfig;
}

function parseGitRemote(): RepoInfo | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) { return undefined; }

    try {
        const cwd = workspaceFolders[0].uri.fsPath;
        const remoteUrl = execSync('git remote get-url origin', { cwd }).toString().trim();
        const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/);
        const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(\.git)?$/);
        const match = httpsMatch || sshMatch;
        if (!match) { return undefined; }
        return { org: match[1], repo: match[2] };
    } catch {
        return undefined;
    }
}

async function getGitHubSession(): Promise<vscode.AuthenticationSession | undefined> {
    try {
        return await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    } catch {
        return undefined;
    }
}

async function fetchFeedbackPR(token: string, org: string, repo: string): Promise<number | undefined> {
    const response = await fetch(
        `https://api.github.com/repos/${org}/${repo}/pulls?state=open`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );

    if (!response.ok) { return undefined; }

    const pulls = await response.json() as Array<{ number: number; title: string }>;
    const feedbackPR = pulls.find(pr => pr.title === 'Feedback');
    return feedbackPR?.number;
}

async function fetchLatestComment(token: string, org: string, repo: string, prNumber: number): Promise<GitHubComment | undefined> {
    const response = await fetch(
        `https://api.github.com/repos/${org}/${repo}/issues/${prNumber}/comments`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );

    if (!response.ok) { return undefined; }

    const comments = await response.json() as GitHubComment[];
    return comments.length > 0 ? comments[comments.length - 1] : undefined;
}

function stripMarkdown(text: string): string {
    return text
        .replace(/#{1,6}\s/g, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .replace(/\n/g, ' ')
        .trim();
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Classroom 50 extension is now active!');

    const session = await getGitHubSession();
    if (!session) {
        vscode.window.showErrorMessage('Classroom 50: não foi possível autenticar com o GitHub.');
        return;
    }

    const config = loadConfig();
    if (!config) { return; }

    const repoInfo = parseGitRemote();
    if (!repoInfo) { return; }

    const token = session.accessToken;
    const { org, repo } = repoInfo;

    // Busca o PR de feedback
    const prNumber = await fetchFeedbackPR(token, org, repo);
    if (!prNumber) {
        vscode.window.showWarningMessage('Classroom 50: PR de feedback não encontrado.');
        return;
    }

    // Salva o ID do último comentário visto
    let lastCommentId: number = context.globalState.get(`lastCommentId_${repo}`, 0);

    // Função de polling
    const checkForNewComments = async () => {
        const comment = await fetchLatestComment(token, org, repo, prNumber);
        if (!comment || comment.id <= lastCommentId) { return; }

        lastCommentId = comment.id;
        context.globalState.update(`lastCommentId_${repo}`, lastCommentId);

        const preview = stripMarkdown(comment.body).substring(0, 100);

        // Nível 1 + 2 + 3
        const action = await vscode.window.showInformationMessage(
            `💬 Novo feedback — ${config['assignment-name']}\n${preview}...`,
            'Ver no GitHub'
        );

        if (action === 'Ver no GitHub') {
            vscode.env.openExternal(vscode.Uri.parse(comment.html_url));
        }
    };

    // Executa imediatamente e depois em intervalos
    await checkForNewComments();

    const intervalMs = config['polling-interval-minutes'] * 60 * 1000;
    const timer = setInterval(checkForNewComments, intervalMs);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate() {}