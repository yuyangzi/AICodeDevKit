import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TaskRegistry, type RegisteredTask } from "../src/subagent"

function makeTask(overrides: Partial<RegisteredTask> = {}): RegisteredTask {
  return { sessionID: "ses-1", parentID: "ses-parent", taskId: "t-1", category: "deep", notified: false, failed: false, ...overrides }
}

describe("TaskRegistry", () => {
  let dir: string
  let reg: TaskRegistry
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "category-router-registry-"))
    reg = new TaskRegistry(dir)
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  test("#given persisted tasks #when new registry loads #then tasks survive restart", async () => {
    await reg.load()
    await reg.add(makeTask())
    const reg2 = new TaskRegistry(dir)
    await reg2.load()
    expect(reg2.get("ses-1")).toMatchObject({ sessionID: "ses-1", notified: false })
  })

  test("#given notified task #when markNotified #then persisted notified flag", async () => {
    await reg.load()
    await reg.add(makeTask())
    await reg.markNotified("ses-1", true)
    const reg2 = new TaskRegistry(dir)
    await reg2.load()
    expect(reg2.get("ses-1")).toMatchObject({ notified: true, failed: true })
  })

  test("#given un-notified completed task in registry #when reconcile #then notifies exactly once", async () => {
    await reg.load()
    await reg.add(makeTask({ sessionID: "ses-done" }))
    const calls: Array<{ id: string; failed: boolean }> = []
    const fakeClient = { session: { messages: async () => ({ data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] }] }) } }
    await reg.reconcile(fakeClient as never, async (task, failed) => { calls.push({ id: task.sessionID, failed }) })
    expect(calls).toEqual([{ id: "ses-done", failed: false }])
    expect(reg.get("ses-done")?.notified).toBe(true)
  })

  test("#given already notified task #when reconcile #then no second notify", async () => {
    await reg.load()
    await reg.add(makeTask({ sessionID: "ses-done", notified: true }))
    const calls: string[] = []
    await reg.reconcile({ session: { messages: async () => ({ data: [] }) } } as never, async (t) => { calls.push(t.sessionID) })
    expect(calls).toEqual([])
  })

  test("#given task with error in child messages #when reconcile #then notifies with failed=true", async () => {
    await reg.load()
    await reg.add(makeTask({ sessionID: "ses-err" }))
    const calls: Array<{ id: string; failed: boolean }> = []
    const fakeClient = { session: { messages: async () => ({ data: [{ info: { role: "assistant", error: { name: "ApiError" } }, parts: [] }] }) } }
    await reg.reconcile(fakeClient as never, async (task, failed) => { calls.push({ id: task.sessionID, failed }) })
    expect(calls).toEqual([{ id: "ses-err", failed: true }])
  })

  test("#given uncompleted task (only user message, no assistant reply) #when reconcile #then no false completion notify", async () => {
    await reg.load()
    await reg.add(makeTask({ sessionID: "ses-interrupted" }))
    const calls: string[] = []
    // 重启被掐断：子会话只有 user prompt 消息，无 assistant 回复
    const fakeClient = { session: { messages: async () => ({ data: [{ info: { role: "user" }, parts: [{ type: "text", text: "the task prompt" }] }] }) } }
    await reg.reconcile(fakeClient as never, async (t) => { calls.push(t.sessionID) })
    expect(calls).toEqual([])
    expect(reg.get("ses-interrupted")?.notified).toBe(false)
  })

  test("#given notify throws (parent session deleted) #when reconcile #then other tasks still reconcile", async () => {
    await reg.load()
    await reg.add(makeTask({ sessionID: "ses-broken-parent" }))
    await reg.add(makeTask({ sessionID: "ses-good" }))
    const calls: Array<{ id: string; failed: boolean }> = []
    const fakeClient = { session: { messages: async () => ({ data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] }] }) } }
    await reg.reconcile(fakeClient as never, async (task, failed) => {
      if (task.sessionID === "ses-broken-parent") throw new Error("parent session gone")
      calls.push({ id: task.sessionID, failed })
    })
    expect(calls).toEqual([{ id: "ses-good", failed: false }])
    expect(reg.get("ses-broken-parent")?.notified).toBe(false)
  })
})