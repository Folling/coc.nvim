import {Neovim} from '@chemzqm/neovim'
import * as language from 'vscode-languageserver-protocol'
import {Disposable, Location, Position} from 'vscode-languageserver-protocol'
import {echoErr, wait, showQuickpick} from './util'
import workspace from './workspace'
const logger = require('./util/logger')('commands')

// command center
export interface Command {
  readonly id: string | string[]
  execute(...args: any[]): void | Promise<any>
}

class CommandItem implements Disposable, Command {
  constructor(
    public id: string,
    private impl: (...args: any[]) => void,
    private thisArg: any
  ) {
  }

  public execute(...args: any[]): void | Promise<any> {
    let {impl, thisArg} = this
    return impl.apply(thisArg, args || [])
  }

  public dispose(): void {
    this.thisArg = null
    this.impl = null
  }
}

export class CommandManager implements Disposable {
  private readonly commands = new Map<string, CommandItem>()

  public init(nvim: Neovim, plugin: any): void {
    this.register({
      id: 'editor.action.triggerSuggest',
      execute: async () => {
        await wait(30)
        await nvim.call('coc#start')
      }
    })
    this.register({
      id: 'editor.action.showReferences',
      execute: async (_filepath: string, _position: Position, references: Location[]) => {
        let items = await Promise.all(references.map(loc => {
          return workspace.getQuickfixItem(loc)
        }))
        await nvim.call('setqflist', [items, ' ', 'Results of references'])
        await nvim.command('doautocmd User CocQuickfixChange')
      }
    })
    this.register({
      id: 'editor.action.rename',
      execute: async (uri: string, position: Position) => {
        await workspace.jumpTo(uri, position)
        await wait(50)
        await plugin.cocAction(['rename'])
      }
    })
    this.register({
      id: 'workspace.diffDocument',
      execute: async () => {
        await workspace.diffDocument()
      }
    })
    this.register({
      id: 'workspace.showOutput',
      execute: async (name?:string) => {
        if (name) {
          workspace.showOutputChannel(name)
        } else {
          let names = workspace.channelNames
          if (names.length == 0) return
          if (names.length == 1) {
            workspace.showOutputChannel(names[0])
          } else {
            let idx = await showQuickpick(nvim, names)
            if (idx == -1) return
            let name = names[idx]
            workspace.showOutputChannel(name)
          }
        }
      }
    })
  }

  public get commandList(): CommandItem[] {
    let res: CommandItem[] = []
    for (let item of this.commands.values()) {
      // ignore internal commands
      if (!/^(_|editor)/.test(item.id)) {
        res.push(item)
      }
    }
    return res
  }

  public dispose(): void {
    for (const registration of this.commands.values()) {
      registration.dispose()
    }
    this.commands.clear()
  }

  public execute(command: language.Command): void {
    let args = [command.command]
    let arr = command.arguments
    if (arr) args.push(...arr)
    this.executeCommand.apply(this, args)
  }

  public register<T extends Command>(command: T): T {
    for (const id of Array.isArray(command.id) ? command.id : [command.id]) {
      this.registerCommand(id, command.execute, command)
    }
    return command
  }

  public has(id: string): boolean {
    return this.commands.has(id)
  }

  public unregister(id: string): void {
    let item = this.commands.get(id)
    if (!item) return
    item.dispose()
    this.commands.delete(id)
  }

  /**
   * Registers a command that can be invoked via a keyboard shortcut,
   * a menu item, an action, or directly.
   *
   * Registering a command with an existing command identifier twice
   * will cause an error.
   *
   * @param command A unique identifier for the command.
   * @param impl A command handler function.
   * @param thisArg The `this` context used when invoking the handler function.
   * @return Disposable which unregisters this command on disposal.
   */
  public registerCommand(id: string, impl: (...args: any[]) => void, thisArg?: any): Disposable {
    if (this.commands.has(id)) return
    this.commands.set(id, new CommandItem(id, impl, thisArg))
    return Disposable.create(() => {
      this.commands.delete(id)
    })
  }

  /**
   * Executes the command denoted by the given command identifier.
   *
   * * *Note 1:* When executing an editor command not all types are allowed to
   * be passed as arguments. Allowed are the primitive types `string`, `boolean`,
   * `number`, `undefined`, and `null`, as well as [`Position`](#Position), [`Range`](#Range), [`Uri`](#Uri) and [`Location`](#Location).
   * * *Note 2:* There are no restrictions when executing commands that have been contributed
   * by extensions.
   *
   * @param command Identifier of the command to execute.
   * @param rest Parameters passed to the command function.
   * @return A thenable that resolves to the returned value of the given command. `undefined` when
   * the command handler function doesn't return anything.
   */
  public executeCommand(command: string, ...rest: any[]): Promise<void> {
    let cmd = this.commands.get(command)
    if (!cmd) {
      echoErr(workspace.nvim, `Command: ${command} not found`)
      return
    }
    return Promise.resolve(cmd.execute.apply(cmd, rest)).catch(e => {
      echoErr(workspace.nvim, `Command error: ${e.message}`)
      logger.error(e.stack)
    })
  }
}

export default new CommandManager()
