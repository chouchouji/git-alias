import os from 'node:os'
import path from 'node:path'
import { isNonEmptyArray } from 'rattail'
import * as vscode from 'vscode'
import { appendAliasToStoreFile, deleteAliases, getAliases, renameAliases } from './aliases'
import { SYSTEM_ALIAS } from './constants'
import storePath from './path'
import type { Alias } from './types'
import { formatUnaliasCommand, isSameAlias, normalizeAliasesToArray, resolveAlias } from './utils'

function setTooltip(frequency = 0) {
  return `${vscode.l10n.t('frequency')}: ${frequency}`
}

export function activate(context: vscode.ExtensionContext) {
  // set default store path
  storePath.path = path.join(os.homedir(), '.zshrc')

  const globalState = context.globalState

  const aliasView = new AliasView(globalState)

  context.subscriptions.push(
    // watch store path
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('alias-manager.defaultStorePath')) {
        const defaultStorePath = vscode.workspace.getConfiguration('alias-manager').get<string>('defaultStorePath')
        if (defaultStorePath) {
          storePath.path = defaultStorePath.startsWith('~')
            ? defaultStorePath.replace('~', os.homedir())
            : defaultStorePath
          aliasView.refresh()
        }
      }
    }),
  )

  context.subscriptions.push(vscode.window.registerTreeDataProvider('aliasView', aliasView))

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.refresh', (alias?: AliasItem) => aliasView.refresh(alias)),
  )

  context.subscriptions.push(vscode.commands.registerCommand('aliasView.add', () => aliasView.addAlias()))

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.deleteAlias', (alias: AliasItem) => aliasView.deleteAlias(alias)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.deleteAllAlias', (alias: AliasItem) => aliasView.deleteAllAlias()),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.renameAliasName', (alias: AliasItem) =>
      aliasView.renameAliasName(alias),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.renameAliasCommand', (alias: AliasItem) =>
      aliasView.renameAliasCommand(alias),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.run', (alias: AliasItem) => aliasView.runAlias(alias)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.copyAllAlias', (alias: AliasItem) => aliasView.copyAllAlias(alias)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.copy', (alias: AliasItem) => aliasView.copyAlias(alias)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.renameGroup', (alias: AliasItem) => aliasView.renameGroup(alias)),
  )

  context.subscriptions.push(vscode.commands.registerCommand('aliasView.newGroup', () => aliasView.addNewGroup()))

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.deleteGroup', (alias: AliasItem) => aliasView.deleteGroup(alias)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.setDescription', (alias: AliasItem) => aliasView.setDescription(alias)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.addToGroup', (alias: AliasItem) => aliasView.addToGroup(alias)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.removeFromCurrentGroup', (alias: AliasItem) =>
      aliasView.removeFromCurrentGroup(alias),
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.sortByAlphabet', (alias: AliasItem) => aliasView.sortByAlphabet(alias)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('aliasView.sortByFrequency', (alias: AliasItem) =>
      aliasView.sortByFrequency(alias),
    ),
  )
}

function executeCommandInTerminal(command: string) {
  const activeTerminal = vscode.window.activeTerminal ?? vscode.window.createTerminal()
  activeTerminal.show()
  activeTerminal.sendText(command)
}

class AliasView implements vscode.TreeDataProvider<AliasItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<AliasItem | undefined | null | undefined> = new vscode.EventEmitter<
    AliasItem | undefined | null | undefined
  >()

  readonly onDidChangeTreeData: vscode.Event<AliasItem | undefined | null | undefined> = this._onDidChangeTreeData.event

  globalState: vscode.Memento

  constructor(globalState: vscode.Memento) {
    this.globalState = globalState
    this.globalState.update(SYSTEM_ALIAS, getAliases(storePath.path))
  }

  refresh(alias?: AliasItem) {
    this._onDidChangeTreeData.fire(alias)
  }

  async setDescription(alias: AliasItem) {
    if (!alias.data) {
      return
    }

    const description = await vscode.window.showInputBox({
      placeHolder: vscode.l10n.t('Please enter new description'),
      value: alias.description,
    })

    // cancel input alias
    if (description === undefined) {
      return
    }

    for (const groupName of this.globalState.keys()) {
      const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(groupName))
      const sameAlias = aliases.find((aliasItem) => isSameAlias(alias.data as Alias, aliasItem))

      if (sameAlias) {
        sameAlias.description = description
        this.globalState.update(groupName, aliases)
      }
    }

    this.refresh()
  }

  async addAlias() {
    const alias = await vscode.window.showInputBox({
      placeHolder: vscode.l10n.t(`Please enter new alias. e.g. alias nv='node -v'`),
      value: undefined,
    })

    // cancel input alias
    if (alias === undefined) {
      return
    }

    if (!alias.length) {
      vscode.window.showErrorMessage(vscode.l10n.t('Alias is mandatory to execute this action'))
      return
    }

    const resolvedAlias = resolveAlias(`alias ${alias}`)
    if (!resolvedAlias) {
      vscode.window.showErrorMessage(vscode.l10n.t('Please check the format of the input content'))
      return
    }

    const aliasNames = getAliases(storePath.path).map((alias) => alias.aliasName)
    if (aliasNames.includes(resolvedAlias.aliasName)) {
      vscode.window.showWarningMessage(vscode.l10n.t('Duplicate alias'))
      return
    }

    appendAliasToStoreFile(storePath.path, alias)

    // add this alias to system group
    const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(SYSTEM_ALIAS))
    aliases.push({
      ...resolvedAlias,
      frequency: 0,
      description: '',
    })
    this.globalState.update(SYSTEM_ALIAS, aliases)

    executeCommandInTerminal(`alias ${alias}`)

    this.refresh()
  }

  async deleteAllAlias() {
    const text = await vscode.window.showInformationMessage(
      vscode.l10n.t('Are you sure to delete all alias?'),
      { modal: true },
      vscode.l10n.t('Confirm'),
    )
    // click cancel button
    if (text === undefined) {
      return
    }

    const aliases = getAliases(storePath.path)
    if (!aliases.length) {
      return
    }

    executeCommandInTerminal(formatUnaliasCommand(aliases))

    deleteAliases(storePath.path)

    // remove all aliases under every groups
    for (const groupName of this.globalState.keys()) {
      this.globalState.update(groupName, [])
    }

    this.refresh()
  }

  deleteAlias(alias: AliasItem) {
    if (!alias.data) {
      return
    }

    // delete specific alias
    deleteAliases(storePath.path, alias.data)

    // remove all aliases under every groups
    for (const groupName of this.globalState.keys()) {
      const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(groupName)).filter(
        (aliasItem) => !isSameAlias(alias.data as Alias, aliasItem),
      )

      this.globalState.update(groupName, aliases)
    }

    executeCommandInTerminal(formatUnaliasCommand([alias.data]))

    this.refresh()
  }

  async renameAliasName(alias: AliasItem) {
    if (!alias.data) {
      return
    }

    const aliasName = await vscode.window.showInputBox({
      placeHolder: vscode.l10n.t('Please enter new alias name'),
      value: alias.data.aliasName,
    })

    // cancel input aliasName
    if (aliasName === undefined) {
      return
    }

    if (!aliasName.length) {
      vscode.window.showErrorMessage(vscode.l10n.t('Alias name is mandatory to execute this action'))
      return
    }

    renameAliases(storePath.path, alias.data, {
      aliasName,
      command: alias.data.command,
    })

    // rename one alias under every groups
    for (const groupName of this.globalState.keys()) {
      const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(groupName))
      const sameAlias = aliases.find((aliasItem) => isSameAlias(alias.data as Alias, aliasItem))

      if (sameAlias) {
        sameAlias.aliasName = aliasName
        this.globalState.update(groupName, aliases)
      }
    }

    executeCommandInTerminal(`alias ${aliasName}='${alias.data.command}'`)
    this.refresh()
  }

  async renameAliasCommand(alias: AliasItem) {
    if (!alias.data) {
      return
    }

    const command = await vscode.window.showInputBox({
      placeHolder: vscode.l10n.t('Please enter new alias command'),
      value: alias.data.command,
    })

    // cancel input command
    if (command === undefined) {
      return
    }

    if (!command.length) {
      vscode.window.showErrorMessage(vscode.l10n.t('Alias command is mandatory to execute this action'))
      return
    }

    renameAliases(storePath.path, alias.data, {
      aliasName: alias.data.aliasName,
      command,
    })

    // rename one alias under every groups
    for (const groupName of this.globalState.keys()) {
      const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(groupName))
      const sameAlias = aliases.find((aliasItem) => isSameAlias(alias.data as Alias, aliasItem))

      if (sameAlias) {
        sameAlias.command = command
        this.globalState.update(groupName, aliases)
      }
    }

    executeCommandInTerminal(`alias ${alias.data.aliasName}='${command}'`)
    this.refresh()
  }

  runAlias(alias: AliasItem) {
    if (!alias.data) {
      return
    }

    const systemAliases = normalizeAliasesToArray<Alias>(this.globalState.get(alias.group))
    const runAlias = systemAliases.find((systemAlias) => isSameAlias(alias.data as Alias, systemAlias))
    if (runAlias) {
      runAlias.frequency = (runAlias.frequency ?? 0) + 1
      this.globalState.update(alias.group, systemAliases)

      alias.tooltip = setTooltip(runAlias.frequency)
      this.refresh(alias)
    }

    executeCommandInTerminal(alias.data.aliasName)
  }

  copyAlias(alias: AliasItem) {
    if (!alias.data) {
      return
    }

    const { aliasName, command } = alias.data
    const content = `alias ${aliasName}='${command}'`

    vscode.env.clipboard.writeText(content)
    vscode.window.showInformationMessage(vscode.l10n.t('Alias has been added to the clipboard Successfully'))
  }

  copyAllAlias(alias: AliasItem) {
    const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(alias.groupName))
    if (!aliases.length) {
      vscode.window.showWarningMessage(vscode.l10n.t('No alias'))
      return
    }

    const content = aliases.map(({ aliasName, command }) => `alias ${aliasName}='${command}'`).join('\n')

    vscode.env.clipboard.writeText(content)
    vscode.window.showInformationMessage(vscode.l10n.t('Alias has been added to the clipboard Successfully'))
  }

  removeFromCurrentGroup(alias: AliasItem) {
    if (!alias.data) {
      return
    }

    const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(alias.group)).filter(
      (aliasItem) => !isSameAlias(alias.data as Alias, aliasItem),
    )

    this.globalState.update(alias.group, aliases)

    this.refresh()
  }

  async addToGroup(alias: AliasItem) {
    if (!alias.data) {
      return
    }

    const groups = this.globalState.keys().filter((key) => ![SYSTEM_ALIAS, alias.group].includes(key))
    if (!groups.length) {
      vscode.window.showWarningMessage('No any group can be added')
      return
    }

    const selectedGroup = await vscode.window.showQuickPick(groups, {
      placeHolder: vscode.l10n.t('Please choose a group to add'),
    })

    // cancel pick group
    if (selectedGroup === undefined) {
      return
    }

    const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(selectedGroup))
    aliases.push(alias.data)
    this.globalState.update(selectedGroup, aliases)

    this.refresh()
  }

  deleteGroup(alias: AliasItem) {
    this.globalState.update(alias.group, undefined)
    this.refresh()
  }

  async renameGroup(alias: AliasItem) {
    const group = await vscode.window.showInputBox({
      placeHolder: vscode.l10n.t('Please enter new group'),
      value: alias.group,
    })

    // cancel input group
    if (group === undefined) {
      return
    }

    if (!group.length) {
      vscode.window.showErrorMessage(vscode.l10n.t('Group is mandatory to execute this action'))
      return
    }

    const hasSameGroup = this.globalState.keys().includes(group)
    if (hasSameGroup) {
      vscode.window.showErrorMessage(vscode.l10n.t('Duplicate group'))
      return
    }

    const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(alias.group))
    this.globalState.update(alias.group, undefined)
    this.globalState.update(group, aliases)

    this.refresh()
  }

  async addNewGroup() {
    const group = await vscode.window.showInputBox({
      placeHolder: vscode.l10n.t('Please enter new group'),
      value: undefined,
    })

    // cancel input group
    if (group === undefined) {
      return
    }

    if (!group.length) {
      vscode.window.showErrorMessage(vscode.l10n.t('Group is mandatory to execute this action'))
      return
    }

    const hasSameGroup = this.globalState.keys().includes(group)
    if (hasSameGroup) {
      vscode.window.showErrorMessage(vscode.l10n.t('Duplicate group'))
      return
    }

    this.globalState.update(group, [])

    this.refresh()
  }

  sortByAlphabet(alias: AliasItem) {
    const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(alias.group))

    if (!aliases.length) {
      return
    }

    aliases.sort((a, b) => a.aliasName.toLowerCase().localeCompare(b.aliasName.toLowerCase()))
    this.globalState.update(alias.group, aliases)

    this.refresh()
  }

  sortByFrequency(alias: AliasItem) {
    const aliases = normalizeAliasesToArray<Alias>(this.globalState.get(alias.group))

    if (!aliases.length) {
      return
    }

    aliases.sort((a, b) => (a.frequency ?? 0) - (b.frequency ?? 0))
    this.globalState.update(alias.group, aliases)

    this.refresh()
  }

  getTreeItem(element: AliasItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: AliasItem): Thenable<AliasItem[]> {
    if (element) {
      return Promise.resolve(element.children)
    }

    return Promise.resolve(this.getAliasTree())
  }

  private getAliasTree(): AliasItem[] {
    this.globalState.update(SYSTEM_ALIAS, getAliases(storePath.path))
    const aliasTree = this.globalState.keys().reduce((aliases: AliasItem[], key: string) => {
      const children = normalizeAliasesToArray<Alias>(this.globalState.get(key)).map((alias) => {
        const { aliasName, command, description = '' } = alias
        return new AliasItem(`${aliasName} = '${command}'`, alias, key, description, [], true)
      })

      aliases.push(new AliasItem(key, undefined, key, '', children, false))
      return aliases
    }, [])

    return aliasTree
  }
}
class AliasItem extends vscode.TreeItem {
  contextValue = 'alias_child'
  description = ''
  data: Alias | undefined = undefined
  groupName: string

  constructor(
    public readonly label: string,
    public readonly alias: Alias | undefined,
    public readonly group: string,
    public readonly remark: string,
    public readonly children: AliasItem[] = [],
    public readonly isLeafNode: boolean = true,
  ) {
    super(
      label,
      isNonEmptyArray(children) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    )

    this.data = alias
    this.groupName = group
    this.description = remark

    this.tooltip = setTooltip(this.alias?.frequency)

    if (!isLeafNode) {
      // parent node
      this.contextValue = label === SYSTEM_ALIAS ? 'alias_system_parent' : 'alias_parent'
    } else {
      // leaf node
      this.contextValue = group === SYSTEM_ALIAS ? 'alias_system_child' : 'alias_child'
    }
  }
}

export function deactivate() {}
