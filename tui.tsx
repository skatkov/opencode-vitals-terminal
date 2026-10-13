import { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { formatCost } from "./src/format.ts"
import { calculateVitals, mergeMessages, projectMessages } from "./src/metrics.ts"
import { SidebarStore } from "./src/sidebar.ts"
import { HistoryStore } from "./src/store.ts"
import { VitalsStore } from "./src/vitals-store.ts"
import { createFooterSummary, createSidebarRows } from "./src/vitals-views.ts"

const updates = [
  "session.inbox.delivered",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.compaction.ended",
] as const

export default Plugin.define({
  id: "opencode-vitals-terminal",
  setup(context) {
    const sidebar = new SidebarStore()
    const cached = (sessionID: string) => {
      const pending = new Set(context.data.session.pending.list(sessionID).map((item) => item.id))
      return projectMessages(context.data.session.message.list(sessionID).filter((message) => !pending.has(message.id)))
    }
    const history = new HistoryStore(
      (input, requestOptions) => context.client.message.list(input, requestOptions),
      cached,
    )
    const vitals = new VitalsStore((sessionID) => {
      const session = context.data.session.get(sessionID)
      return calculateVitals(
        mergeMessages(history.get(sessionID)?.messages ?? [], cached(sessionID)),
        context.data.location.model.list(session?.location),
        session?.revert?.messageID,
      )
    })
    const views = { history, vitals, sidebar, cost: (sessionID: string) => context.data.session.cost(sessionID) }

    function showVitals(sessionID: string) {
      history.ensure(sessionID)
      context.ui.dialog.set({ size: "medium" })
      context.ui.dialog.show(() => {
        const metrics = vitals.observe(sessionID)
        const number = (value: number) => value.toLocaleString("en-US")
        return (
          <box gap={1} padding={1}>
            <text fg={context.theme.text.base}><b>Vitals</b></text>
            <Show when={history.get(sessionID)?.loading}>
              <text fg={context.theme.text.muted}>Reading full session history…</text>
            </Show>
            <Show when={history.get(sessionID)?.error}>
              <text fg={context.theme.text.muted}>Partial totals: {history.get(sessionID)?.error}</text>
            </Show>
            <text fg={context.theme.text.base}>
              {number(metrics().turns)} turns · {number(metrics().steps)} steps ({number(metrics().completedSteps)} completed)
            </text>
            <text fg={context.theme.text.base}>{number(metrics().totalTokens)} total tokens</text>
            <box>
              <text fg={context.theme.text.muted}>Input: {number(metrics().tokens.input)}</text>
              <text fg={context.theme.text.muted}>Output: {number(metrics().tokens.output)}</text>
              <text fg={context.theme.text.muted}>Reasoning: {number(metrics().tokens.reasoning)}</text>
              <text fg={context.theme.text.muted}>Cache read: {number(metrics().tokens.cache.read)}</text>
              <text fg={context.theme.text.muted}>Cache write: {number(metrics().tokens.cache.write)}</text>
            </box>
            <Show when={metrics().context}>
              {(usage) => <text fg={context.theme.text.muted}>
                Context: {number(usage().tokens)} tokens{usage().percent === undefined ? "" : ` (${usage().percent}% used)`}
              </text>}
            </Show>
            <text fg={context.theme.text.muted}>Spent: {formatCost(context.data.session.cost(sessionID))}</text>
            <text fg={context.theme.text.muted}>Turns = delivered user messages. Steps = model calls, including a running step.</text>
            <text fg={context.theme.text.muted}>This session only; subagents have their own counters. Esc to close.</text>
          </box>
        )
      })
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-vitals-terminal.show",
          title: "Show session vitals",
          group: "Vitals",
          palette: true,
          slash: { name: "vitals" },
          enabled: () => context.ui.router.current().type === "session",
          run: () => {
            const route = context.ui.router.current()
            if (route.type === "session") showVitals(route.sessionID)
          },
        },
        {
          id: "opencode-vitals-terminal.refresh",
          title: "Refresh session vitals",
          group: "Vitals",
          palette: true,
          slash: { name: "vitals-refresh" },
          enabled: () => context.ui.router.current().type === "session",
          run: async () => {
            const route = context.ui.router.current()
            if (route.type === "session") await history.refresh(route.sessionID)
          },
        },
      ],
    }))

    const stopEvents = [
      context.data.on("server.connected", () => history.reconnect()),
      context.data.on("session.deleted", (event) => history.forget(event.data.sessionID)),
      context.data.on("session.revert.committed", (event) => queueMicrotask(() => history.truncate(event.data.sessionID, event.data.to))),
      ...updates.map((type) => context.data.on(type, (event) =>
        queueMicrotask(() => history.update(event.data.sessionID)))),
    ]

    const stopFooter = context.ui.slot({
      // Disable only opencode.prompt.footer in cli.json. Appending here keeps
      // the host's spinner/location and editor-file child slots intact.
      append: "prompt.footer",
      render: (props) => {
        const dimensions = useTerminalDimensions()
        const shortcut = (id: string) => context.keymap.shortcuts(id)[0]
        const live = createMemo(() => {
          if (!props.sessionID) return ""
          const children = context.data.session.family(props.sessionID)
            .filter((id) => id !== props.sessionID && context.data.session.status(id) === "running").length
          const shells = context.data.shell.list(context.location)
            .filter((shell) => shell.metadata.sessionID === props.sessionID).length
          return [
            children ? `${children} subagent${children === 1 ? "" : "s"}` : undefined,
            shells ? `${shells} shell${shells === 1 ? "" : "s"}` : undefined,
          ].filter(Boolean).join(" · ")
        })
        const available = createMemo(() => {
          const width = Math.max(0, dimensions().width - 8)
          return Math.max(0, width - Math.min(28, Math.floor(width / 3)))
        })
        const summary = createFooterSummary(views, () => props.sessionID,
          () => Math.max(0, available() - (live() ? live().length + 3 : 0)))
        const commands = createMemo(() => {
          const command = shortcut("command.palette.show")
          if (!command || dimensions().width < 44) return false
          return !summary() || `${live()}${live() ? " · " : ""}${summary()} · ${command} commands`.length <= available()
        })

        return (
          <Switch>
            <Match when={props.mode === "shell"}>
              <text fg={context.theme.text.base} flexShrink={0}>
                esc <span style={{ fg: context.theme.text.muted }}>{dimensions().width < 44 ? "shell" : "exit shell mode"}</span>
              </text>
            </Match>
            <Match when={props.mode === "normal"}>
              <Show when={live() || (props.showDetails && summary())}>
                <box flexDirection="row" flexShrink={0} minWidth={0} maxWidth={available()}>
                  <Show when={live()}>
                    <text fg={context.theme.text.muted} wrapMode="none" truncate
                      onMouseUp={() => context.keymap.dispatch("session.child.first")}>{live()}</text>
                  </Show>
                  <Show when={props.showDetails && summary()}>
                    <text fg={context.theme.text.muted} wrapMode="none" truncate
                      onMouseUp={() => props.sessionID && showVitals(props.sessionID)}>
                      {live() ? " · " : ""}{summary()}
                    </text>
                  </Show>
                </box>
              </Show>
              <Show when={!summary() && props.showDetails && dimensions().width >= 44}>
                <text fg={context.theme.text.base} flexShrink={0}>
                  {shortcut("agent.cycle")} <span style={{ fg: context.theme.text.muted }}>agents</span>
                </text>
              </Show>
              <Show when={props.showDetails && commands()}>
                <text fg={context.theme.text.base} wrapMode="none" flexShrink={0}>
                  {shortcut("command.palette.show")} <span style={{ fg: context.theme.text.muted }}>commands</span>
                </text>
              </Show>
            </Match>
          </Switch>
        )
      },
    })

    const stopSidebar = context.ui.slot({
      append: "sidebar.content",
      render: (props) => {
        const rows = createSidebarRows(views, () => props.sessionID)
        return (
          <box onMouseUp={() => showVitals(props.sessionID)}>
            <text fg={context.theme.text.base}><b>Vitals</b></text>
            <For each={rows()}>
              {(row) => <text fg={context.theme.text.muted}>
                {row.label}: <span style={{ fg: context.theme.text.base }}>{row.value}</span>
              </text>}
            </For>
          </box>
        )
      },
    })

    return () => {
      for (const stop of stopEvents) stop()
      stopFooter()
      stopSidebar()
      history.dispose()
      vitals.dispose()
    }
  },
})
