import * as vscode from 'vscode';
import { Hub } from './hub';

/** "Skill Hub · 3 applied · 1 update" for the active folder; hidden when the folder has no skills. Click opens the sidebar. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('skillHub.status', vscode.StatusBarAlignment.Left, 10);
  private readonly listener: vscode.Disposable;
  private version = 0;

  constructor(private readonly hub: Hub) {
    this.item.name = 'Skill Hub';
    this.item.command = 'skillHub.showRepo';
    this.listener = hub.onDidChange(() => void this.update());
    void this.update();
  }

  private async update(): Promise<void> {
    const version = ++this.version;
    const folder = this.hub.activeFolder();
    const skills = folder ? await this.hub.workspaceSkills(folder).catch(() => []) : [];
    if (version !== this.version) return;
    const applied = skills.filter((s) => s.lock).length;
    if (!folder || !applied) {
      this.item.hide();
      return;
    }
    const updates = skills.filter((s) => s.status === 'outdated' || s.status === 'conflict').length;
    const attention = skills.filter((s) => s.status === 'modified' || s.status === 'missing').length;
    const parts = [`${applied} applied`, updates && `${updates} update${updates === 1 ? '' : 's'}`, attention && `${attention} need attention`].filter(Boolean);
    this.item.text = `$(layers) Skill Hub · ${parts.join(' · ')}`;
    this.item.tooltip = `Skills applied to ${folder.name}. Click to open Skill Hub.`;
    this.item.show();
  }

  dispose(): void {
    this.listener.dispose();
    this.item.dispose();
  }
}
