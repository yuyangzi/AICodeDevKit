import { join } from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"

export interface AvailableModelsClient {
  provider: { list(): Promise<{ data?: { all?: Array<{ id: string; models?: Record<string, unknown> }>; connected?: string[] } }> }
}

export async function resolveAvailableModels(client: AvailableModelsClient): Promise<Set<string>> {
  try {
    const res = await client.provider.list()
    const data = res.data
    const connected = new Set(data?.connected ?? [])
    const out = new Set<string>()
    for (const provider of data?.all ?? []) {
      if (!connected.has(provider.id)) continue
      for (const modelID of Object.keys(provider.models ?? {})) {
        out.add(`${provider.id}/${modelID}`)
      }
    }
    return out
  } catch {
    return new Set()
  }
}

export interface RegisteredTask {
  sessionID: string
  parentID: string
  taskId: string
  category: string
  notified: boolean
  failed: boolean
}

export interface MessagesClient {
  session: { messages(opts: { path: { id: string } }): Promise<{ data?: Array<{ info?: { role?: string; error?: unknown }; parts?: Array<{ type?: string; text?: string }> }> }> }
}

export class TaskRegistry {
  private file: string
  private tasks = new Map<string, RegisteredTask>()

  constructor(projectRoot: string) {
    this.file = join(projectRoot, ".opencode", "category-router", "tasks.json")
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, "utf8")
      const parsed = JSON.parse(raw) as RegisteredTask[]
      this.tasks = new Map(parsed.map((t) => [t.sessionID, t]))
    } catch {
      this.tasks = new Map()
    }
  }

  async add(task: RegisteredTask): Promise<void> {
    this.tasks.set(task.sessionID, task)
    await this.persist()
  }

  get(sessionID: string): RegisteredTask | undefined {
    return this.tasks.get(sessionID)
  }

  async markNotified(sessionID: string, failed: boolean): Promise<void> {
    const task = this.tasks.get(sessionID)
    if (!task) return
    task.notified = true
    task.failed = failed
    await this.persist()
  }

  /** Startup reconciliation: re-notify completed-but-unnotified tasks after restart. */
  async reconcile(client: MessagesClient, notify: (task: RegisteredTask, failed: boolean) => Promise<void>): Promise<void> {
    for (const task of [...this.tasks.values()]) {
      if (task.notified) continue
      const msgs = await client.session.messages({ path: { id: task.sessionID } }).catch(() => ({ data: [] }))
      const list = msgs?.data ?? []
      if (list.length === 0) continue
      const last = list[list.length - 1]
      // 仅当最后一条是 assistant 回复（有结果或错误）才视为"已完成"。
      // 进程重启被掐断的未完成子会话里只有 user prompt 消息（role!=="assistant"），
      // 不得补发虚假"完成"通知——对齐 spec §13"未完成任务停留 notified:false"。
      if (!last?.info || last.info.role !== "assistant") continue
      const failed = Boolean(last.info.error)
      try {
        await notify(task, failed)
        await this.markNotified(task.sessionID, failed)
      } catch {
        // 单任务通知失败（如父会话已删除）不中断对账循环；未标记条目留待下次对账（spec §9 尽力而为）
      }
    }
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(join(this.file, ".."), { recursive: true })
      await writeFile(this.file, JSON.stringify([...this.tasks.values()], null, 2))
    } catch {
      // 尽力而为；写盘失败降级为内存态（spec §13）
    }
  }
}

export interface PromptBody {
  model: { providerID: string; modelID: string }
  agent: string
  parts: Array<{ type: "text"; text: string }>
  noReply: boolean
  variant?: string
}

/** SDK 的 SessionPromptData.body 暂缺 variant 字段（核心已支持），用显式类型携带。 */
export function buildPromptBody(
  model: { providerID: string; modelID: string },
  variant: string | undefined,
  opts: { agent: string; parts: Array<{ type: "text"; text: string }>; noReply: boolean },
): PromptBody {
  return {
    model,
    agent: opts.agent,
    parts: opts.parts,
    noReply: opts.noReply,
    ...(variant !== undefined ? { variant } : {}),
  }
}