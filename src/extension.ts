'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { Highlighter, Highlight } from './highlighter';
import CredentialManager from './credentialManager';
import {
  TwitchHighlighterDataProvider,
  HighlighterNode
} from './twitchHighlighterTreeView';
import { TwitchChatClient } from './twitchChatClient';
import { isArray } from 'util';
import { extSuffix, Settings, Commands } from './constants';

let highlightDecorationType: vscode.TextEditorDecorationType;
const twitchHighlighterStatusBarIcon: string = '$(plug)'; // The octicon to use for the status bar icon (https://octicons.github.com/)
let highlighters: Array<Highlighter> = new Array<Highlighter>();
let twitchChatClient: TwitchChatClient;

let twitchHighlighterTreeView: TwitchHighlighterDataProvider;
let twitchHighlighterStatusBar: vscode.StatusBarItem;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  setupDecoratorType();

  updateChannelsSetting();

  twitchChatClient = new TwitchChatClient(
    context.asAbsolutePath(path.join('out', 'twitchLanguageServer.js')),
    context.subscriptions
  );

  twitchChatClient.onHighlight = highlight;
  twitchChatClient.onUnhighlight = unhighlight;
  twitchChatClient.onBannedUser = handleBannedUser;
  twitchChatClient.onConnected = () => setConnectionStatus(true);
  twitchChatClient.onConnecting = () => setConnectionStatus(false, true);
  twitchChatClient.onDisconnected = () => {
    setConnectionStatus(false);
  };

  twitchHighlighterTreeView = new TwitchHighlighterDataProvider(() => {
    return highlighters;
  });
  vscode.window.registerTreeDataProvider(
    'twitchHighlighterTreeView',
    twitchHighlighterTreeView
  );

  // Creates the status bar toggle button
  twitchHighlighterStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
  );
  twitchHighlighterStatusBar.command = Commands.toggleChat;
  twitchHighlighterStatusBar.tooltip = `Twitch Highlighter Extension`;
  context.subscriptions.push(twitchHighlighterStatusBar);

  setConnectionStatus(false);
  twitchHighlighterStatusBar.show();

  // #region command registrations
  registerCommand(context, Commands.highlight, highlightHandler);
  registerCommand(context, Commands.gotoHighlight, gotoHighlightHandler);
  registerCommand(context, Commands.removeHighlight, removeHighlightHandler);
  registerCommand(
    context,
    Commands.unhighlightSpecific,
    unhighlightSpecificHandler
  );
  registerCommand(context, Commands.unhighlightAll, unhighlightAllHandler);
  registerCommand(context, Commands.refreshTreeView, refreshTreeViewHandler);
  registerCommand(
    context,
    Commands.removeTwitchClientId,
    removeTwitchClientIdHandler
  );
  registerCommand(context, Commands.setTwitchToken, setTwitchTokenHandler);
  registerCommand(
    context,
    Commands.removeTwitchToken,
    removeTwitchTokenHandler
  );
  registerCommand(context, Commands.startChat, startChatHandler);
  registerCommand(context, Commands.stopChat, stopChatHandler);
  registerCommand(context, Commands.toggleChat, toggleChatHandler);
  // #endregion command registrations

  // #region command handlers
  function gotoHighlightHandler(line: number, document: vscode.TextDocument) {
    vscode.window.showTextDocument(document).then(editor => {
      line = line < 3 ? 2 : line;
      editor.revealRange(document.lineAt(line - 2).range);
    });
  }

  function removeHighlightHandler(highlighterNode: HighlighterNode) {
    const highlightsToRemove = Array<{
      lineNumber: number;
      fileName: string;
    }>();
    highlighterNode.highlights.map(highlight =>
      highlightsToRemove.push({
        lineNumber: highlight.startLine,
        fileName: highlighterNode.document.fileName
      })
    );
    highlightsToRemove.forEach(v =>
      removeHighlight(v.lineNumber, v.fileName, true)
    );
    twitchHighlighterTreeView.refresh();
  }

  function refreshTreeViewHandler() {
    twitchHighlighterTreeView.refresh();
  }

  function removeTwitchClientIdHandler() {
    CredentialManager.deleteTwitchClientId()
      .then((value: boolean) => {
        vscode.window.showInformationMessage(
          `Twitch Chat Client Id removed from your keychain`
        );
      })
      .catch(reason => {
        vscode.window.showInformationMessage(
          `Failed to remove the Twitch Chat Client Id`
        );
        console.error(
          'An error occured while removing your Client Id from the keychain'
        );
        console.error(reason);
      });
  }

  /**
   * This function handles removing any highlights that were created from a user that was banned in chat
   * @param bannedUserName name of the user that was banned in the chat
   */
  function handleBannedUser(bannedUserName: string) {
    removeHighlight(bannedUserName);
  }

  async function setTwitchTokenHandler(): Promise<boolean> {
    const value = await vscode.window.showInputBox({
      prompt:
        'Enter Twitch token. Generate a token here: http://www.twitchapps.com/tmi',
      ignoreFocusOut: true,
      password: true
    });
    if (value === undefined || value === null) {
      return false;
    }
    await CredentialManager.setPassword(value)
      .then(() => {
        vscode.window.showInformationMessage(
          `Twitch Chat token saved in your keychain`
        );
      })
      .catch(reason => {
        vscode.window.showInformationMessage(
          `Failed to set Twitch Chat token`
        );
        console.error(
          'An error occured while saving your token to the keychain'
        );
        console.error(reason);
      });
    return true;
  }

  function removeTwitchTokenHandler() {
    CredentialManager.deleteTwitchToken()
      .then((value: boolean) => {
        vscode.window.showInformationMessage(
          `Twitch Chat token removed from your keychain`
        );
      })
      .catch(reason => {
        vscode.window.showInformationMessage(
          `Failed to remove the Twitch Chat token`
        );
        console.error(
          'An error occured while removing your token from the keychain'
        );
        console.error(reason);
      });
  }

  function highlightHandler() {
    vscode.window
      .showInputBox({ prompt: 'Enter a line number' })
      .then(lineString =>
        highlight('self', +(lineString || 0), +(lineString || 0))
      );
  }

  function unhighlightAllHandler() {
    vscode.window.visibleTextEditors.forEach(visibleEditor => {
      visibleEditor.setDecorations(highlightDecorationType, []);
    });
    highlighters = new Array<Highlighter>();
    twitchHighlighterTreeView.refresh();
  }

  function unhighlightSpecificHandler() {
    if (highlighters.length === 0) {
      vscode.window.showInformationMessage(
        'There are no highlights to unhighlight'
      );
    }

    let pickerOptions: Array<string> = new Array<string>();
    highlighters.forEach(highlighter => {
      pickerOptions = [...pickerOptions, ...highlighter.getPickerDetails()];
    });

    vscode.window.showQuickPick(pickerOptions).then(pickedOption => {
      if (!pickedOption) {
        vscode.window.showErrorMessage('A valid highlight was not selected.');
        return;
      }
      const [pickedFile, lineNumber] = pickedOption.split(', ');
      const lineNumberInt = parseInt(lineNumber);
      removeHighlight(lineNumberInt, pickedFile);
    });
  }

  function startChatHandler() {
    twitchChatClient.start(setTwitchTokenHandler);
  }

  async function stopChatHandler() {
    const config = vscode.workspace.getConfiguration(extSuffix);
    let unhighlightOnDisconnect = config.get<boolean>(
      Settings.unhighlightOnDisconnect
    );

    if (
      highlighters.length > 0 &&
      highlighters.some(h => h.highlights.length > 0) &&
      !unhighlightOnDisconnect
    ) {
      const result = await vscode.window.showInformationMessage(
        'Do you want to keep or remove the existing highlights when disconnecting from chat?',
        'Always Remove',
        'Remove',
        'Keep'
      );
      if (result && result === 'Remove') {
        unhighlightOnDisconnect = true;
      }
      if (result && result === 'Always Remove') {
        unhighlightOnDisconnect = true;
        config.update(Settings.unhighlightOnDisconnect, true, true);
      }
    }

    if (unhighlightOnDisconnect) {
      unhighlightAllHandler();
    }

    twitchChatClient.stop();
  }

  function toggleChatHandler() {
    if (!twitchChatClient.isConnected()) {
      startChatHandler();
    } else {
      stopChatHandler();
    }
  }
  // #endregion command handlers

  // #region vscode events
  vscode.workspace.onDidChangeConfiguration(
    event => {
      if (event.affectsConfiguration(extSuffix)) {
        setupDecoratorType();
      }
    },
    null,
    context.subscriptions
  );
  vscode.window.onDidChangeActiveTextEditor(
    editor => {
      activeEditor = editor;
      if (editor) {
        triggerUpdateDecorations();
      }
    },
    null,
    context.subscriptions
  );

  vscode.workspace.onDidChangeTextDocument(
    document => {
      if (activeEditor && document.document === activeEditor.document) {
        triggerUpdateDecorations();
      }
    },
    null,
    context.subscriptions
  );

  vscode.workspace.onDidCloseTextDocument(
    document => {
      if (document.isUntitled) {
        highlighters = highlighters.filter(
          highlight => highlight.editor.document !== document
        );
        triggerUpdateDecorations();
        twitchHighlighterTreeView.refresh();
      }
    },
    null,
    context.subscriptions
  );
  // #endregion
}

export function deactivate(): Thenable<void> {
  if (!twitchChatClient) {
    return Promise.resolve();
  }
  return twitchChatClient.dispose();
}

function highlight(
  twitchUser: string,
  startLine: number,
  endLine: number,
  fileName?: string,
  comment?: string
) {
  console.log(`highlight called.`);
  if (!startLine) {
    console.warn('A line number was not provided to highlight');
    return;
  }

  let editor = vscode.window.activeTextEditor;
  if (!editor) {
    console.log('No active text editor is present.');
    return;
  }

  const doc = editor.document;
  const existingHighlighter = highlighters.find(highlighter => {
    return highlighter.editor.document.fileName === doc.fileName;
  });

  // Do not highlight a line already requested by the same user.
  if (
    existingHighlighter &&
    existingHighlighter.highlights.some(
      h => h.twitchUser === twitchUser && h.startLine === startLine
    )
  ) {
    console.log(
      `An existing highlight already exists for '${twitchUser}' starting on line '${startLine}'`
    );
    return;
  }

  const range = getHighlightRange(startLine, endLine, doc);
  if (range.isEmpty) {
    /**
     * TODO: Maybe whisper to the end-user that the line requested is empty.
     * Although whispers aren't gaurenteed to reach the end-user.
     */
    console.log(`line #'${startLine}' is empty. Cancelled.`);
    return;
  }

  const decoration = {
    range,
    hoverMessage: `From @${twitchUser === 'self' ? 'You' : twitchUser}${
      comment !== undefined ? `: ${comment}` : ''
      }`
  };

  addHighlight(
    existingHighlighter,
    decoration,
    editor,
    startLine,
    endLine,
    twitchUser
  );
}

function unhighlight(lineNumber: number, fileName?: string) {
  console.log('unhighlight called.');
  if (!lineNumber) {
    vscode.window.showWarningMessage(
      'A line number was not provided to unhighlight.'
    );
    return;
  }

  let currentDocumentFileName: string;
  if (!fileName) {
    // We need to assume it's for the currently opened file
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage(
        'A file was not found to perform the unhighlight.'
      );
      return;
    }
    currentDocumentFileName = editor.document.fileName;
  } else {
    const existingHighlighter = highlighters.find(highlighter => {
      return highlighter.editor.document.fileName.includes(fileName);
    });
    if (!existingHighlighter) {
      vscode.window.showWarningMessage(
        'A file was not found to perform the unhighlight.'
      );
      return;
    }
    currentDocumentFileName = existingHighlighter.editor.document.fileName;
  }

  removeHighlight(lineNumber, currentDocumentFileName);
}

// Listen for active text editor or document so we don't lose any existing highlights
let activeEditor = vscode.window.activeTextEditor;
if (activeEditor) {
  triggerUpdateDecorations();
}

function setConnectionStatus(connected: boolean, isConnecting?: boolean) {
  if (connected) {
    twitchHighlighterStatusBar.text = `${twitchHighlighterStatusBarIcon} Connected`;
  } else {
    if (isConnecting) {
      twitchHighlighterStatusBar.text = `${twitchHighlighterStatusBarIcon} Connecting...`;
    } else {
      twitchHighlighterStatusBar.text = `${twitchHighlighterStatusBarIcon} Disconnected`;
    }
  }
}

function triggerUpdateDecorations() {
  if (!activeEditor) {
    return;
  }
  let existingHighlight = highlighters.find(highlight => {
    return (
      highlight.editor.document.fileName === activeEditor!.document.fileName
    );
  });
  if (existingHighlight) {
    activeEditor.setDecorations(
      highlightDecorationType,
      existingHighlight.getAllDecorations()
    );
  }
}

function addHighlight(
  existingHighlighter: Highlighter | undefined,
  decoration: { range: vscode.Range; hoverMessage: string },
  editor: vscode.TextEditor,
  startLine: number,
  endLine: number,
  twitchUser: string
) {
  if (existingHighlighter) {
    // We have a new decoration for a highlight with decorations already in a file
    // Add the decoration (a.k.a. style range) to the existing highlight's decoration array
    // Reapply decoration type for updated decorations array in this highlight
    existingHighlighter.addHighlight(
      new Highlight(decoration, startLine, endLine, twitchUser)
    );
  } else {
    const highlighter = new Highlighter(editor, [
      new Highlight(decoration, startLine, endLine, twitchUser)
    ]);
    highlighters.push(highlighter);
  }
  triggerUpdateDecorations();
  twitchHighlighterTreeView.refresh();
}

function removeHighlight(username: string): void;
function removeHighlight(lineNumber: number, fileName: string, deferRefresh?: boolean): void;
function removeHighlight(
  searchQuery: string | number,
  fileName?: string,
  deferRefresh?: boolean
) {
  if (isNaN(Number(searchQuery))) {
    const username = searchQuery as string;
    highlighters.forEach(highlighter => highlighter.removeDecorations(username));
  }
  // the searchQuery is a number (lineNumber)
  else {
    if (!fileName) { return; } // the fileName should always be truthy, but tslint generates warnings.

    const existingHighlight = findHighlighter(fileName);
    if (!existingHighlight) {
      console.warn(`Highlight not found so can't unhighlight the line from file`);
      return;
    }

    const lineNumber = searchQuery as number;
    existingHighlight.removeDecoration(lineNumber);
  }

  if (!deferRefresh) {
    triggerUpdateDecorations();
    twitchHighlighterTreeView.refresh();
  }
}

function findHighlighter(fileName: string): Highlighter | undefined {
  return highlighters.find(highlighter => {
    return highlighter.editor.document.fileName === fileName;
  });
}

function getHighlightRange(
  startLine: number,
  endLine: number,
  doc: vscode.TextDocument
) {
  // prefix string with plus (+) to make string a number
  // well at least that's what codephobia says :P
  // const zeroIndexedLineNumber = +lineNumber - 1;
  // note: doc.lineAt is zero based index so remember to always do -1 from input
  // const zeroIndexStartLineNumber = startLine - 1;
  // const zeroIndexedEndLineNumber = endLine - 1;
  let textLine = doc.lineAt(--endLine);
  let textLineLength = textLine.text.length;
  let range = new vscode.Range(
    new vscode.Position(--startLine, 0),
    new vscode.Position(endLine, textLineLength)
  );
  return range;
}

/**
 * Registers a command that can be invoked via a keyboard shortcut, a menu item, an action, or directly.
 * @param context The Extension context
 * @param name The unique name of the command
 * @param handler The callback function for the command
 * @param thisArgs The `this` context used when invoking the handler function.
 */
function registerCommand(
  context: vscode.ExtensionContext,
  name: string,
  handler: (...args: any[]) => void,
  thisArgs?: any
) {
  let disposable = vscode.commands.registerCommand(name, handler, thisArgs);
  context.subscriptions.push(disposable);
}

/**
 * Used to upgrade the channels setting from an array of strings ['clarkio','parithon']
 * to a string 'clarkio, parithon'.
 */
function updateChannelsSetting() {
  const configuration = vscode.workspace.getConfiguration(extSuffix);
  const channels = configuration.get<string>(Settings.channels);
  if (isArray(channels)) {
    // Update the global settings
    configuration.update(Settings.channels, channels.join(', '), true);
  }
}

function setupDecoratorType() {
  const configuration = vscode.workspace.getConfiguration(extSuffix);
  highlightDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: configuration.get<string>(Settings.highlightColor) || 'green',
    border: configuration.get<string>(Settings.highlightBorder) || '2px solid white',
    color: configuration.get<string>(Settings.highlightFontColor) || 'white'
  });
}
