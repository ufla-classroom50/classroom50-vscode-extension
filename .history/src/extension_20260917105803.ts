import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface ExtensionConfig {
    'assignment-name': string;
    'polling-interval-minutes': number;
    'notify-from-users': string[];
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
        vscode.window.showErrorMessage('Classroom 50: no folder open in workspace.');
        return undefined;
    }

    const configPath = path.join(workspaceFolders[0].uri.fsPath, '.c50extension.json');
    if (!fs.existsSync(configPath)) {
        vscode.window.showErrorMessage('Classroom 50: .c50extension.json file not found.');
        return undefined;
    }

    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8')) as ExtensionConfig;
    } catch {
        vscode.window.showErrorMessage('Classroom 50: .c50extension.json file is invalid.');
        return undefined;
    }
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
        if (!match) {
            vscode.window.showErrorMessage('Classroom 50: could not identify the GitHub repository.');
            return undefined;
        }
        return { org: match[1], repo: match[2] };
    } catch {
        vscode.window.showErrorMessage('Classroom 50: open folder is not a git repository.');
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
        vscode.window.showErrorMessage('Classroom 50: could not authenticate with GitHub.');
        return;
    }

    const config = loadConfig();
    if (!config) { return; }

    const repoInfo = parseGitRemote();
    if (!repoInfo) { return; }

    const token = session.accessToken;
    const { org, repo } = repoInfo;

    const prNumber = await fetchFeedbackPR(token, org, repo);
    if (!prNumber) {
        vscode.window.showWarningMessage('Classroom 50: feedback PR not found.');
        return;
    }

    const prUrl = `https://github.com/${org}/${repo}/pull/${prNumber}`;

    let lastCommentId: number = context.globalState.get(`lastCommentId_${repo}`, 0);

    const checkForNewComments = async () => {
        const comment = await fetchLatestComment(token, org, repo, prNumber);
        if (!comment || comment.id <= lastCommentId) { return; }

        const allowedUsers = config['notify-from-users'];
        if (allowedUsers.length > 0 && !allowedUsers.includes(comment.user.login)) { return; }

        lastCommentId = comment.id;
        context.globalState.update(`lastCommentId_${repo}`, lastCommentId);

        const preview = stripMarkdown(comment.body).substring(0, 100);

        const action = await vscode.window.showInformationMessage(
            `💬 New feedback — ${config['assignment-name']}\n${preview}...`,
            'View on GitHub'
        );

        if (action === 'View on GitHub') {
            vscode.env.openExternal(vscode.Uri.parse(comment.html_url));
        }
    };

    const checkCommand = vscode.commands.registerCommand(
        'classroom50-vscode-extension.checkFeedback',
        async () => {
            await checkForNewComments();
            vscode.window.showInformationMessage('Classroom 50: check completed.');
        }
    );
    context.subscriptions.push(checkCommand);

    const openPRCommand = vscode.commands.registerCommand(
        'classroom50-vscode-extension.openFeedbackPR',
        () => {
            vscode.env.openExternal(vscode.Uri.parse(prUrl));
        }
    );
    context.subscriptions.push(openPRCommand);

    const checkStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    checkStatusBarItem.text = '$(bell) Check Feedback';
    checkStatusBarItem.tooltip = 'Classroom 50: check for new feedback';
    checkStatusBarItem.command = 'classroom50-vscode-extension.checkFeedback';
    checkStatusBarItem.show();
    context.subscriptions.push(checkStatusBarItem);

    const openPRStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 999);
    openPRStatusBarItem.text = '$(git-pull-request) Feedback PR';
    openPRStatusBarItem.tooltip = 'Classroom 50: open feedback PR in browser';
    openPRStatusBarItem.command = 'classroom50-vscode-extension.openFeedbackPR';
    openPRStatusBarItem.show();
    context.subscriptions.push(openPRStatusBarItem);

    await checkForNewComments();

    const intervalMs = config['polling-interval-minutes'] * 60 * 1000;
    const timer = setInterval(checkForNewComments, intervalMs);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate() {}