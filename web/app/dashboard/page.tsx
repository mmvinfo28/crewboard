"use client";

import {
  AddRounded,
  ArrowOutwardRounded,
  CheckRounded,
  ChevronRightRounded,
  CloseRounded,
  ComputerRounded,
  ContentCopyRounded,
  DashboardOutlined,
  DevicesOutlined,
  FolderOpenOutlined,
  GroupsOutlined,
  HistoryOutlined,
  HubOutlined,
  LinkRounded,
  LockOutlined,
  MenuRounded,
  MoreHorizRounded,
  NotificationsNoneRounded,
  PauseRounded,
  PersonAddAltOutlined,
  PlayArrowRounded,
  SearchRounded,
  TaskAltOutlined,
  TerminalRounded,
} from "@mui/icons-material";
import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";

type AgentState = "ready" | "working" | "paused" | "offline";

type Agent = {
  id: number;
  name: string;
  model: string;
  owner: string;
  state: AgentState;
  task: string;
  tone: string;
};

const initialAgents: Agent[] = [
  { id: 1, name: "Claude Planner", model: "Claude 4", owner: "Maya", state: "ready", task: "Waiting for a task", tone: "violet" },
  { id: 2, name: "Codex Builder", model: "GPT-5 Codex", owner: "Noah", state: "working", task: "Building onboarding flow", tone: "charcoal" },
  { id: 3, name: "Codex Reviewer", model: "GPT-5 Codex", owner: "You", state: "ready", task: "Waiting for a task", tone: "blue" },
  { id: 4, name: "Gemini Research", model: "Gemini 2.5", owner: "Maya", state: "offline", task: "Device disconnected", tone: "amber" },
];

const activity = [
  { initials: "NB", text: <><strong>Noah</strong> assigned onboarding to <strong>Codex Builder</strong></>, time: "2m" },
  { initials: "CP", text: <><strong>Claude Planner</strong> shared a product outline</>, time: "8m" },
  { initials: "AR", text: <><strong>You</strong> joined Weekend Builders</>, time: "21m" },
  { initials: "MR", text: <><strong>Maya</strong> connected a new device</>, time: "34m" },
];

function StateBadge({ state }: { state: AgentState }) {
  return <span className={`state-badge ${state}`}><i />{state}</span>;
}

function ConnectorModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [step, setStep] = useState(1);
  const [copied, setCopied] = useState(false);

  function copyCommand() {
    navigator.clipboard?.writeText("npx @crewboard/connector connect");
    setCopied(true);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="connector-modal" role="dialog" aria-modal="true" aria-labelledby="connector-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <span className="section-code">CONNECTOR / 0{step}</span>
            <h2 id="connector-title">Connect this computer</h2>
          </div>
          <button className="icon-button" aria-label="Close connector setup" onClick={onClose}><CloseRounded /></button>
        </header>

        <div className="step-line" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((item) => <span key={item} className={item <= step ? "active" : ""} />)}
        </div>

        {step === 1 && (
          <div className="modal-body">
            <div className="setup-illustration"><ComputerRounded /></div>
            <h3>Your AI stays on your machine.</h3>
            <p>Crewboard adds a small connector that lets this party send approved tasks to the AI tools already installed on your computer.</p>
            <div className="safety-list">
              <div><LockOutlined /><span><strong>Logins stay local</strong>Your Claude and Codex credentials never go to Crewboard.</span></div>
              <div><FolderOpenOutlined /><span><strong>You choose the folders</strong>Only shared project folders can be accessed.</span></div>
              <div><TaskAltOutlined /><span><strong>You control approvals</strong>Review sensitive actions before an agent runs them.</span></div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="modal-body">
            <div className="setup-illustration"><TerminalRounded /></div>
            <h3>Run one command.</h3>
            <p>Open Terminal on this computer and paste the command below. The connector will guide you through the rest.</p>
            <button className="command-box" onClick={copyCommand}>
              <code>npx @crewboard/connector connect</code>
              <span>{copied ? <CheckRounded /> : <ContentCopyRounded />}{copied ? "Copied" : "Copy"}</span>
            </button>
            <p className="quiet-note">Works with macOS, Windows, and Linux. No admin access needed.</p>
          </div>
        )}

        {step === 3 && (
          <div className="modal-body success-body">
            <div className="success-mark"><CheckRounded /></div>
            <h3>Computer connected.</h3>
            <p>We found two AI tools on Alex&apos;s computer. They are ready to join the party.</p>
            <div className="detected-tools">
              <div><span className="tool-mark claude">C</span><span><strong>Claude Code</strong><small>Ready</small></span><CheckRounded /></div>
              <div><span className="tool-mark codex">X</span><span><strong>Codex</strong><small>Ready</small></span><CheckRounded /></div>
            </div>
          </div>
        )}

        <footer className="modal-footer">
          <span>Step {step} of 3</span>
          <div>
            {step > 1 && step < 3 && <button className="button ghost" onClick={() => setStep(step - 1)}>Back</button>}
            <button className="button primary" onClick={() => {
              if (step < 3) setStep(step + 1);
              else { onConnected(); onClose(); }
            }}>
              {step === 1 ? "Continue" : step === 2 ? "I ran the command" : "Go to workspace"}<ChevronRightRounded />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export default function Home() {
  const [agents, setAgents] = useState(initialAgents);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [task, setTask] = useState("");
  const [assigned, setAssigned] = useState(false);
  const [userInitials, setUserInitials] = useState("—");
  const [cloudConnected, setCloudConnected] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      const label = typeof data.user?.user_metadata.display_name === "string"
        ? data.user.user_metadata.display_name
        : data.user?.email ?? "Member";
      const initials = label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
      setUserInitials(initials || "ME");
    });

    fetch("/api/health")
      .then((response) => setCloudConnected(response.ok))
      .catch(() => setCloudConnected(false));
  }, []);

  async function signOut() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  function toggleAgent(id: number) {
    setAgents((current) => current.map((agent) => agent.id === id && agent.state !== "offline"
      ? { ...agent, state: agent.state === "paused" ? "ready" : "paused", task: agent.state === "paused" ? "Waiting for a task" : "Paused by you" }
      : agent));
  }

  function assignTask() {
    if (!task.trim()) return;
    setAssigned(true);
    setTask("");
    window.setTimeout(() => setAssigned(false), 2500);
  }

  return (
    <main className="dashboard-shell">
      <header className="global-nav">
        <div className="nav-brand-wrap">
          <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(!mobileNav)}><MenuRounded /></button>
          <a className="wordmark" href="/">Crewboard</a>
        </div>
        <nav className="top-links" aria-label="Global navigation">
          <a className="active" href="/dashboard">Workspace</a>
          <a href="#">Network</a>
          <a href="#">Docs</a>
        </nav>
        <div className="nav-actions">
          <button className="search-button"><SearchRounded /><span>Search</span><kbd>⌘ K</kbd></button>
          <button className="icon-button" aria-label="Notifications"><NotificationsNoneRounded /></button>
          <button className="nav-avatar" title="Sign out" aria-label="Sign out" onClick={signOut}>{userInitials}</button>
        </div>
      </header>

      <div className="dashboard-body">
        <aside className={`side-panel ${mobileNav ? "mobile-open" : ""}`}>
          <div className="party-switcher">
            <span className="party-avatar">WB</span>
            <span><small>ACTIVE PARTY</small><strong>Weekend Builders</strong></span>
            <MoreHorizRounded />
          </div>

          <nav className="side-nav" aria-label="Party navigation">
            <p>Workspace</p>
            <a className="active" href="#"><DashboardOutlined />Overview</a>
            <a href="#agents"><HubOutlined />Agents <span>4</span></a>
            <a href="#tasks"><TaskAltOutlined />Tasks <span>3</span></a>
            <a href="#activity"><HistoryOutlined />Activity</a>
            <p>Party</p>
            <a href="#"><GroupsOutlined />People <span>3</span></a>
            <a href="#"><DevicesOutlined />Devices <span>{connected ? 3 : 2}</span></a>
          </nav>

          <div className={`connector-status ${connected ? "is-connected" : ""}`}>
            <div className="connector-status-head"><span><i />{connected ? "DEVICE ONLINE" : "CONNECTOR OFFLINE"}</span><LinkRounded /></div>
            <p>{connected ? "Alex’s computer is connected and ready." : "Connect your computer to add Claude, Codex, or Gemini."}</p>
            <button onClick={() => setConnectorOpen(true)}>{connected ? "Manage device" : "Connect device"}<ArrowOutwardRounded /></button>
          </div>

          <button className="create-party"><AddRounded />New party</button>
        </aside>

        <section className="main-workspace">
          <div className="page-heading">
            <div>
              <span className="section-code">PARTY / OVERVIEW</span>
              <h1>Weekend Builders</h1>
              <p>Coordinate people and AI agents from one shared workspace.</p>
            </div>
            <div className="heading-actions">
              <button className="button secondary" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/join/weekend-builders`)}><PersonAddAltOutlined />Invite</button>
              <button className="button primary" onClick={() => setConnectorOpen(true)}><LinkRounded />{connected ? "Manage connector" : "Connect device"}</button>
            </div>
          </div>

          <section className="metrics-grid" aria-label="Party overview">
            <article><span>ONLINE NOW</span><strong>3</strong><small><i className="green-dot" /> 2 people, 1 agent</small></article>
            <article><span>AI AGENTS</span><strong>4</strong><small>3 available to the party</small></article>
            <article><span>OPEN TASKS</span><strong>3</strong><small>1 actively running</small></article>
            <article><span>COMPLETED</span><strong>12</strong><small className="positive">+4 this week</small></article>
          </section>

          <div className="workspace-grid">
            <div className="primary-column">
              <section className="panel" id="agents">
                <header className="panel-header">
                  <div><span className="section-code">01 / AGENTS</span><h2>AI teammates</h2></div>
                  <button className="text-button"><AddRounded />Add agent</button>
                </header>
                <div className="agent-table">
                  <div className="agent-table-head"><span>Agent</span><span>Owner</span><span>Status</span><span>Current task</span><span /></div>
                  {agents.map((agent) => (
                    <div className="agent-row" key={agent.id}>
                      <div className="agent-identity"><span className={`agent-mark ${agent.tone}`}>{agent.name.charAt(0)}</span><span><strong>{agent.name}</strong><small>{agent.model}</small></span></div>
                      <span className="owner-cell">{agent.owner}</span>
                      <StateBadge state={agent.state} />
                      <span className="task-cell">{agent.task}</span>
                      <button className="row-action" aria-label={`${agent.state === "paused" ? "Resume" : "Pause"} ${agent.name}`} disabled={agent.state === "offline"} onClick={() => toggleAgent(agent.id)}>
                        {agent.state === "paused" ? <PlayArrowRounded /> : <PauseRounded />}
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel task-panel" id="tasks">
                <header className="panel-header">
                  <div><span className="section-code">02 / DELEGATE</span><h2>Give the team a task</h2></div>
                  <span className="keyboard-hint">⌘ ↵ to send</span>
                </header>
                <textarea value={task} onChange={(event) => setTask(event.target.value)} onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") assignTask();
                }} placeholder="Describe what you want done, for example: review the onboarding flow and open a pull request…" />
                <div className="composer-actions">
                  <button className="agent-select"><span className="agent-mark violet">C</span>Claude Planner + Codex Builder<ChevronRightRounded /></button>
                  <button className="button primary" disabled={!task.trim()} onClick={assignTask}>{assigned ? <CheckRounded /> : <PlayArrowRounded />}{assigned ? "Task assigned" : "Assign task"}</button>
                </div>
              </section>
            </div>

            <aside className="secondary-column">
              <section className="panel compact-panel" id="activity">
                <header className="panel-header"><div><span className="section-code">LIVE</span><h2>Party activity</h2></div><span className="live-indicator"><i />LIVE</span></header>
                <div className="activity-list">
                  {activity.map((item, index) => <div className="activity-item" key={index}><span className="activity-avatar">{item.initials}</span><p>{item.text}<time>{item.time} ago</time></p></div>)}
                </div>
                <button className="full-width-link">View full activity<ChevronRightRounded /></button>
              </section>

              <section className="panel connector-card">
                <span className="section-code">YOUR CONNECTOR</span>
                <div className="connector-icon"><ComputerRounded /></div>
                <h2>{connected ? "Alex’s computer" : "Your AI tools are missing"}</h2>
                <p>{connected ? "Claude Code and Codex are available to this party." : "Connect this computer once to bring your Claude, Codex, or Gemini into the workspace."}</p>
                {connected && <div className="connected-tools"><span><i className="claude-dot" />Claude Code</span><span><i className="codex-dot" />Codex</span></div>}
                <button className="button dark" onClick={() => setConnectorOpen(true)}>{connected ? "Connector settings" : "Connect this computer"}<ArrowOutwardRounded /></button>
                <small><LockOutlined />Credentials always stay on your device.</small>
              </section>
            </aside>
          </div>

          <footer className="prototype-note"><span>{cloudConnected ? "CLOUD CONNECTED" : "CONNECTING"}</span> Accounts and party data are protected by Supabase. Dashboard rows are preview data until your first party is created.</footer>
        </section>
      </div>

      {connectorOpen && <ConnectorModal onClose={() => setConnectorOpen(false)} onConnected={() => setConnected(true)} />}
    </main>
  );
}
