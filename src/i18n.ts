/**
 * Translation of messages (English and Brazilian Portuguese).
 *
 * VS Code's official API (vscode.l10n) always follows the editor language.
 * The teacher asked for a language setting, so this module implements the
 * same idea with an override. Command names and view titles come from
 * package.nls.*.json and always follow the VS Code language.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export type Language = "en" | "pt-br";

const SETTING_SECTION = "classroom50";
const SETTING_NAME = "language";

let currentLanguage: Language = "en";
let translations: Record<string, string> = {};

/**
 * The `classroom50.language` setting wins; with "auto", Portuguese is used
 * when VS Code is in Portuguese and English otherwise.
 */
function resolveLanguage(): Language {
  const setting = vscode.workspace
    .getConfiguration(SETTING_SECTION)
    .get<string>(SETTING_NAME, "auto");
  if (setting === "en" || setting === "pt-br") {
    return setting;
  }
  return vscode.env.language.toLowerCase().startsWith("pt") ? "pt-br" : "en";
}

/**
 * Loads `l10n/bundle.l10n.<language>.json`, which maps each English message to
 * its translation (the same format as VS Code's official localization).
 */
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

/**
 * Resolves the language and loads its translations. Called first in activate().
 * A language change requires a reload because status bar buttons and other
 * texts are created once, during activation.
 */
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

/**
 * Translates a message. The English text is the key, so untranslated messages
 * still show in English. Placeholders `{0}`, `{1}`... are replaced by `args`.
 *
 * @example t("💬 New feedback from @{0} — {1}", author, assignmentName)
 */
export function t(message: string, ...args: Array<string | number>): string {
  const template = translations[message] ?? message;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
}

/** Locale used to format dates in the chosen language. */
export function locale(): string {
  return currentLanguage === "pt-br" ? "pt-BR" : "en";
}
