

import * as vscode from 'vscode';



export function activate(context: vscode.ExtensionContext) {



	console.log('Congratulations, your extension "test-multifile-1" is now active!');




	const disposable = vscode.commands.registerCommand('test-multifile-1.helloWorld', () => {


		vscode.window.showInformationMessage('Hello World from test-multifile-1!');
	});

	context.subscriptions.push(disposable);
}


export function deactivate() { }
