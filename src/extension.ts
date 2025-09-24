import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface Pal {
  path: string;
  name: string;
}

let palsRoot: string;
let pals: Pal[] = [];
let activePal: Pal | undefined;
let currentWebview: vscode.Webview | undefined;
let currentWebviewView: vscode.WebviewView | undefined;

export function activate(context: vscode.ExtensionContext) {
  palsRoot = path.join(context.extensionPath, 'pals');
  if (!fs.existsSync(palsRoot)) {
    fs.mkdirSync(palsRoot, { recursive: true });
  }

  // Load existing pals
  pals = loadPals();

  // Restore saved active pal
  const savedPalName = context.globalState.get<string>('activePalName');
  if (savedPalName) {
    const savedPal = pals.find(p => p.name === savedPalName);
    if (savedPal) {
      activePal = savedPal;
    } else if (pals.length > 0) {
      activePal = pals[0];
    }
  } else if (pals.length > 0) {
    activePal = pals[0];
  }


  // ---- COMMANDS ----
  context.subscriptions.push(
    vscode.commands.registerCommand('codepal.registerPal', () => registerPal(context)),
    vscode.commands.registerCommand('codepal.choosePal', () => choosePal(context)),
    vscode.commands.registerCommand('codepal.deletePal', () => deletePal(context)),
    vscode.commands.registerCommand('codepal.openPalsDir', () => {
      vscode.env.openExternal(vscode.Uri.file(palsRoot));
    }),
    vscode.commands.registerCommand('codepal.setPanicLimit', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter panic limit (number of errors before top level is reached)',
        validateInput: (val) => isNaN(Number(val)) ? 'Must be a number' : undefined
      });
      if (!input) {return;}

      const newLimit = parseInt(input, 10);
      if (isNaN(newLimit) || newLimit <= 0) {
        vscode.window.showErrorMessage('Panic limit must be a positive number');
        return;
      }

      await vscode.workspace.getConfiguration('codepal').update(
        'panicLimit',
        newLimit,
        vscode.ConfigurationTarget.Global
      );
      vscode.window.showInformationMessage(`Panic limit set to ${newLimit}`);
    })
  );

  // ---- WEBVIEW PROVIDER ----
  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(webviewView) {
      webviewView.webview.options = { enableScripts: true };
      currentWebview = webviewView.webview;
      currentWebviewView = webviewView;

      // Set initial panel title
      webviewView.title = activePal ? `${activePal.name}` : 'none';

      webviewView.webview.html = getWebviewContent();

      let lastNumErrors = -1;
      let currentPicture = '';

      const updateDiagnostics = () => {
        const [numErrors, numWarnings] = getNumErrors();
        if (numErrors !== lastNumErrors || !currentPicture) {
          lastNumErrors = numErrors;
          currentPicture = getPicture(numErrors, numWarnings, webviewView.webview, context);
        }

        webviewView.webview.postMessage({ 
          numErrors, 
          numWarnings, 
          currentPicture,
          activePalName: activePal?.name
        });
      };

      // Show picture immediately on load
      updateDiagnostics();

      context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(updateDiagnostics));
      context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateDiagnostics));
    }
  };

  vscode.window.registerWebviewViewProvider('codePalView', provider);
}

// ---- HELPERS ----

function loadPals(): Pal[] {
  if (!fs.existsSync(palsRoot)) { return []; }
  return fs.readdirSync(palsRoot, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => ({
      path: path.join(palsRoot, dirent.name),
      name: dirent.name
    }));
}

async function registerPal(context: vscode.ExtensionContext) {
  const palName = await vscode.window.showInputBox({
    prompt: 'Enter a name for the new pal',
    placeHolder: 'MyPal'
  });
  if (!palName) { return; }

  const palDir = path.join(palsRoot, palName);
  if (fs.existsSync(palDir)) {
    vscode.window.showErrorMessage(`Pal "${palName}" already exists.`);
    return;
  }

  const templateDir = path.join(context.extensionPath, 'assets', 'template-pal');
  if (!fs.existsSync(templateDir)) {
    vscode.window.showErrorMessage('Template pal not found in assets/template-pal.');
    return;
  }

  copyRecursiveSync(templateDir, palDir);

  const newPal: Pal = { path: palDir, name: palName };
  pals.push(newPal);
  activePal = newPal;

  // Save active pal globally
  activePal = newPal;
  context.globalState.update('activePalName', activePal.name);

  // Reset the webview so it accepts the new active pal immediately
  if (currentWebview) {
    currentWebview.postMessage({ resetCurrentSrc: true, activePalName: activePal.name });
  }

  // Update panel title
  if (currentWebviewView) {
    currentWebviewView.title = `${activePal.name}`;
  }

  refreshWebview(context);

  // Show info message with "Open Folder" button
  const choice = await vscode.window.showInformationMessage(
    `Registered new pal: ${palName} (Active)`,
    'Open Folder'
  );

  if (choice === 'Open Folder') {
    vscode.env.openExternal(vscode.Uri.file(palDir));
  }

  refreshWebview(context);
}


async function choosePal(context: vscode.ExtensionContext) {
  // Rescan the pals directory
  pals = loadPals();

  if (pals.length === 0) {
    vscode.window.showInformationMessage('No pals registered yet.');
    return;
  }

  const picked = await vscode.window.showQuickPick(pals.map(p => p.name), {
    placeHolder: 'Select active pal'
  });
  if (!picked) { return; }

  activePal = pals.find(p => p.name === picked);

  // Save active pal globally
  if (activePal) {
    context.globalState.update('activePalName', activePal.name);
    if (currentWebviewView) {
      currentWebviewView.title = activePal.name;
    }
  }

  vscode.window.showInformationMessage(`Active pal set to: ${activePal?.name}`);

  // Reset currentSrc in the webview so old images don’t interfere
  if (currentWebview) {
    currentWebview.postMessage({ resetCurrentSrc: true });
  }

  refreshWebview(context);
}

async function deletePal(context: vscode.ExtensionContext) {
  // Rescan pals
  pals = loadPals();

  if (pals.length === 0) {
    vscode.window.showInformationMessage('No pals available to delete.');
    return;
  }

  const picked = await vscode.window.showQuickPick(pals.map(p => p.name), {
    placeHolder: 'Select pal to delete'
  });
  if (!picked) {return;}

  const palToDelete = pals.find(p => p.name === picked);
  if (!palToDelete) {return;}

  const confirmed = await vscode.window.showWarningMessage(
    `Are you sure you want to delete pal "${palToDelete.name}"? This cannot be undone.`,
    { modal: true },
    'Delete'
  );

  if (confirmed !== 'Delete') {return;}

  // Delete folder recursively
  fs.rmSync(palToDelete.path, { recursive: true, force: true });

  // Remove from pals array
  pals = pals.filter(p => p.name !== palToDelete.name);

  // If deleted pal was active, pick a new active pal
  if (activePal?.name === palToDelete.name) {
  activePal = pals.length > 0 ? pals[0] : undefined;
  context.globalState.update('activePalName', activePal?.name || '');

  // Reset the webview so it accepts the new active pal immediately
  if (currentWebview) {
    currentWebview.postMessage({ resetCurrentSrc: true, activePalName: activePal?.name });
    }
  }

  refreshWebview(context);


  // Update panel title
  if (currentWebviewView) {
    currentWebviewView.title = activePal ? activePal.name : 'none';
  }

  vscode.window.showInformationMessage(`Pal "${palToDelete.name}" deleted.`);

  refreshWebview(context);
}

function copyRecursiveSync(src: string, dest: string) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function refreshWebview(context: vscode.ExtensionContext) {
  if (!currentWebview) { return; }

  const [numErrors, numWarnings] = getNumErrors();

  const currentPicture = activePal ? getPicture(numErrors, numWarnings, currentWebview, context) : '';

  currentWebview.postMessage({ 
    numErrors, 
    numWarnings, 
    currentPicture,
    activePalName: activePal?.name
  });
}


// ---- DIAGNOSTICS ----
function getNumErrors(): [number, number] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return [0, 0]; }

  const uri = editor.document.uri;
  const diagnostics = vscode.languages.getDiagnostics(uri);

  let errors = 0, warnings = 0;
  for (const diag of diagnostics) {
    if (diag.severity === vscode.DiagnosticSeverity.Error) { errors++; }
    else if (diag.severity === vscode.DiagnosticSeverity.Warning) { warnings++; }
  }
  return [errors, warnings];
}

// ---- PICTURE SELECTION ----
function getPicture(errorsNum: number, _warnings: number, webview: vscode.Webview, context: vscode.ExtensionContext): string {
  if (!activePal) { return ''; }

  const panicLimit = vscode.workspace.getConfiguration('codepal').get<number>('panicLimit', 30);

  const subDirs = fs.readdirSync(activePal.path, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d+$/.test(d.name))
    .map(d => parseInt(d.name, 10))
    .sort((a, b) => a - b);

  if (subDirs.length === 0) { return ''; }

  const maxLevel = subDirs[subDirs.length - 1];
  let targetLevel = 0;

  if (errorsNum >= panicLimit) {
    targetLevel = maxLevel;
  } else if (errorsNum > 0) {
    const scaled = Math.floor((errorsNum / panicLimit) * maxLevel);
    targetLevel = Math.min(Math.max(1, scaled), maxLevel);
  }

  const targetFolder = path.join(activePal.path, String(targetLevel));
  if (!fs.existsSync(targetFolder)) { return ''; }

  const images = fs.readdirSync(targetFolder).filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f));
  if (images.length === 0) { return ''; }

  const randomImage = images[Math.floor(Math.random() * images.length)];
  const imageUri = vscode.Uri.file(path.join(targetFolder, randomImage));
  return webview.asWebviewUri(imageUri).toString();
}


function getWebviewContent() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Code Pal</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 10px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        #diagnostics {
          font-size: 1.2em;
          margin-bottom: 10px;
        }

        #picture-container {
          position: relative;
          width: 100%;
          max-width: 100%;
          overflow: hidden;
          transition: height 0.5s ease-in-out;
        }

        #picture-container img {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: auto;
          border-radius: 4px;
          opacity: 0;
          transition: opacity 0.5s ease-in-out;
          z-index: 1;
        }

        #picture-container img.visible {
          opacity: 1;
          z-index: 2;
        }
      </style>
    </head>
    <body>
      <h2 id="diagnostics">Errors: 0</h2>
      <div id="picture-container">
        <img id="picture1" alt="Picture A" />
        <img id="picture2" alt="Picture B" />
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        const pic1 = document.getElementById('picture1');
        const pic2 = document.getElementById('picture2');
        const container = document.getElementById('picture-container');
        const diagnosticsEl = document.getElementById('diagnostics');
        let showingPic1 = true;
        let currentSrc = "";
        let currentPal = null;

        function adjustContainerHeight(img) {
          if (!img.naturalWidth || !img.naturalHeight) return;
          const aspectRatio = img.naturalHeight / img.naturalWidth;
          container.style.height = container.offsetWidth * aspectRatio + 'px';
        }

        window.addEventListener('message', event => {
          const { numErrors, currentPicture, activePalName, resetCurrentSrc } = event.data;

          if (resetCurrentSrc) {
            currentSrc = null;
            currentPal = activePalName;
            return;
          }

          // Ignore messages from previous pal
          if (currentPal && activePalName !== currentPal) return;

          currentPal = activePalName;

          diagnosticsEl.textContent = \`Errors: \${numErrors}\`;

          if (!currentPicture || currentPicture === currentSrc) return;
          currentSrc = currentPicture;

          const nextImg = showingPic1 ? pic2 : pic1;
          const prevImg = showingPic1 ? pic1 : pic2;

          nextImg.src = currentPicture;
          nextImg.classList.add('visible');

          nextImg.onload = () => {
            adjustContainerHeight(nextImg);
            nextImg.style.opacity = 1;
            prevImg.style.opacity = 0;

            setTimeout(() => {
              prevImg.classList.remove('visible');
            }, 500);
          };

          showingPic1 = !showingPic1;
        });

        window.addEventListener('resize', () => {
          const visibleImg = showingPic1 ? pic2 : pic1;
          if (visibleImg.src) adjustContainerHeight(visibleImg);
        });
      </script>
    </body>
    </html>
  `;
}

// ---- DEACTIVATE ----
export function deactivate() {}
