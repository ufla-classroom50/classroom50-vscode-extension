import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export type Language = "en" | "pt-br";

const SETTING_SECTION = "classroom50";
const SETTING_NAME = "language";

let currentLanguage: Language = "en";
let translations: Record<string, string> = {};

function resolveLanguage(): Language {
  const setting = vscode.workspace
    .getConfiguration(SETTING_SECTION)
    .get<string>(SETTING_NAME, "auto");
  if (setting === "en" || setting === "pt-br") {
    return setting;
  }
  return vscode.env.language.toLowerCase().startsWith("pt") ? "pt-br" : "en";
}

function loadBundle(extensionPath: string, language: Language): void {
  translations = {};
  if (language === "en") {
    return;
  }
  const bundlePath = path.join(
    extensionPath,
    "l10n",
    `bundle.l10n.${language}.json`,
  );
  try {
    translations = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  } catch (err) {
    console.error(`Classroom 50: could not load ${bundlePath}`, err);
  }
}

export function initI18n(context: vscode.ExtensionContext): void {
  currentLanguage = resolveLanguage();
  loadBundle(context.extensionPath, currentLanguage);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration(`${SETTING_SECTION}.${SETTING_NAME}`)) {
        return;
      }
      const reload = t("Reload window");
      const action = await vscode.window.showInformationMessage(
        t("Classroom 50: reload the window to apply the new language."),
        reload,
      );
      if (action === reload) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    }),
  );
}

export function t(message: string, ...args: Array<string | number>): string {
  const template = translations[message] ?? message;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
}

export function locale(): string {
  return currentLanguage === "pt-br" ? "pt-BR" : "en";
}
