using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace CrewboardControl
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ControlForm());
        }
    }

    internal sealed class ControlForm : Form
    {
        private readonly string repoRoot;
        private readonly string cliPath;
        private readonly string configPath;
        private readonly string logPath;
        private readonly Panel statusDot;
        private readonly Label statusLabel;
        private readonly Label detailLabel;
        private readonly TextBox activityBox;
        private readonly Button startButton;
        private readonly Button stopButton;
        private readonly Button restartButton;
        private readonly Button pairButton;
        private readonly Button codexLoginButton;
        private readonly Button refreshButton;
        private readonly Timer refreshTimer;
        private bool busy;

        public ControlForm()
        {
            repoRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            cliPath = Path.Combine(repoRoot, "connector", "bin", "crewboard.js");
            configPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Crewboard", "connector.json");
            logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Crewboard", "connector.log");

            Text = "Crewboard Control";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(560, 486);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.FromArgb(24, 27, 34);
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 9F);

            Controls.Add(NewLabel("Crewboard", 28, 20, 20F, FontStyle.Bold, Color.White, 250, 42));
            Controls.Add(NewLabel("Local connector control", 31, 61, 9F, FontStyle.Regular, Color.FromArgb(159, 166, 181), 250, 24));

            Panel statusCard = new Panel {
                Left = 28, Top = 92, Width = 504, Height = 86,
                BackColor = Color.FromArgb(32, 36, 45)
            };
            Controls.Add(statusCard);

            statusDot = new Panel {
                Left = 18, Top = 18, Width = 14, Height = 14,
                BackColor = Color.FromArgb(120, 126, 140)
            };
            statusCard.Controls.Add(statusDot);
            statusLabel = NewLabel("Checking connector...", 43, 11, 12F, FontStyle.Bold, Color.White, 435, 29);
            statusCard.Controls.Add(statusLabel);
            detailLabel = NewLabel("Reading local status", 18, 47, 9F, FontStyle.Regular, Color.FromArgb(159, 166, 181), 468, 26);
            statusCard.Controls.Add(detailLabel);

            startButton = NewButton("Start", 28, 198, 112, Color.FromArgb(24, 130, 82));
            stopButton = NewButton("Stop", 150, 198, 112, Color.FromArgb(171, 55, 65));
            restartButton = NewButton("Restart", 272, 198, 112, Color.FromArgb(49, 105, 190));
            refreshButton = NewButton("Refresh", 394, 198, 138, Color.FromArgb(45, 50, 61));
            Controls.AddRange(new Control[] { startButton, stopButton, restartButton, refreshButton });

            Button dashboardButton = NewButton("Open Dashboard", 28, 248, 246, Color.FromArgb(45, 50, 61));
            Button logButton = NewButton("View Log", 286, 248, 246, Color.FromArgb(45, 50, 61));
            Controls.AddRange(new Control[] { dashboardButton, logButton });

            pairButton = NewButton("Pair / Reconnect", 28, 298, 246, Color.FromArgb(102, 66, 184));
            codexLoginButton = NewButton("Sign in to Codex", 286, 298, 246, Color.FromArgb(102, 66, 184));
            Controls.AddRange(new Control[] { pairButton, codexLoginButton });

            Controls.Add(NewLabel("Activity", 30, 353, 9F, FontStyle.Bold, Color.White, 120, 23));
            activityBox = new TextBox {
                Left = 28, Top = 377, Width = 504, Height = 72,
                Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
                BackColor = Color.FromArgb(19, 21, 27),
                ForeColor = Color.FromArgb(205, 211, 222),
                BorderStyle = BorderStyle.FixedSingle,
                Text = "Ready."
            };
            Controls.Add(activityBox);
            Controls.Add(NewLabel("Closing this window leaves Crewboard running.", 29, 456, 8F, FontStyle.Regular, Color.FromArgb(115, 122, 137), 360, 20));

            startButton.Click += delegate { RunAction("start"); };
            stopButton.Click += delegate { RunAction("stop"); };
            restartButton.Click += delegate { RunAction("restart"); };
            refreshButton.Click += delegate { UpdateStatus(true); };
            pairButton.Click += delegate { BeginPairing(); };
            codexLoginButton.Click += delegate { BeginCodexLogin(); };
            dashboardButton.Click += delegate { OpenDashboard(); };
            logButton.Click += delegate { OpenLog(); };

            refreshTimer = new Timer { Interval = 10000 };
            refreshTimer.Tick += delegate { UpdateStatus(false); };
            refreshTimer.Start();
            Shown += delegate { UpdateStatus(true); };
            FormClosed += delegate { refreshTimer.Stop(); };
        }

        private static Label NewLabel(string text, int left, int top, float size, FontStyle style, Color color, int width, int height)
        {
            return new Label {
                Text = text, Left = left, Top = top, Width = width, Height = height,
                ForeColor = color, Font = new Font("Segoe UI", size, style)
            };
        }

        private static Button NewButton(string text, int left, int top, int width, Color color)
        {
            Button button = new Button {
                Text = text, UseMnemonic = false, Left = left, Top = top,
                Width = width, Height = 38, FlatStyle = FlatStyle.Flat,
                BackColor = color, ForeColor = Color.White,
                Cursor = Cursors.Hand, Font = new Font("Segoe UI Semibold", 9F)
            };
            button.FlatAppearance.BorderSize = 0;
            return button;
        }

        private string InvokeCrewboard(string command)
        {
            if (!File.Exists(cliPath)) throw new FileNotFoundException("Crewboard connector was not found.", cliPath);
            string node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
            if (!File.Exists(node)) node = "node.exe";
            ProcessStartInfo info = new ProcessStartInfo {
                FileName = node,
                Arguments = "\"" + cliPath + "\" " + command,
                WorkingDirectory = repoRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (Process process = Process.Start(info)) {
                string output = process.StandardOutput.ReadToEnd();
                string error = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(error) ? output.Trim() : error.Trim());
                return output.Trim();
            }
        }

        private void SetBusy(bool value)
        {
            busy = value;
            UseWaitCursor = value;
            startButton.Enabled = !value;
            stopButton.Enabled = !value;
            restartButton.Enabled = !value;
            refreshButton.Enabled = !value;
            pairButton.Enabled = !value;
            codexLoginButton.Enabled = !value;
        }

        private void UpdateStatus(bool showActivity)
        {
            if (busy) return;
            SetBusy(true);
            try {
                string status = InvokeCrewboard("status");
                Match running = Regex.Match(status, @"Connector: running \(PID ([0-9]+)\)");
                Match pairing = Regex.Match(status, @"(?m)^Pairing: (.+)$");
                Match agents = Regex.Match(status, @"(?m)^Local agents: (.+)$");
                if (running.Success) {
                    statusDot.BackColor = Color.FromArgb(48, 196, 119);
                    statusLabel.Text = "Connected and running  -  PID " + running.Groups[1].Value;
                    detailLabel.Text = "Agents: " + (agents.Success ? agents.Groups[1].Value.Trim() : "checking");
                    startButton.Enabled = false;
                    stopButton.Enabled = true;
                    restartButton.Enabled = true;
                } else {
                    statusDot.BackColor = Color.FromArgb(229, 78, 87);
                    statusLabel.Text = "Connector stopped";
                    detailLabel.Text = "Pairing: " + (pairing.Success ? pairing.Groups[1].Value.Trim() : "unknown");
                    startButton.Enabled = true;
                    stopButton.Enabled = false;
                    restartButton.Enabled = true;
                }
                if (showActivity) activityBox.Text = "Status refreshed at " + DateTime.Now.ToString("HH:mm:ss") + ".";
            } catch (Exception error) {
                statusDot.BackColor = Color.FromArgb(232, 168, 56);
                statusLabel.Text = "Could not read connector status";
                detailLabel.Text = error.Message;
                activityBox.Text = error.Message;
                startButton.Enabled = true;
                stopButton.Enabled = false;
                restartButton.Enabled = true;
            } finally {
                busy = false;
                UseWaitCursor = false;
                refreshButton.Enabled = true;
                pairButton.Enabled = true;
                codexLoginButton.Enabled = true;
            }
        }

        private void BeginPairing()
        {
            try {
                string node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
                if (!File.Exists(node)) node = "node.exe";
                Process.Start(new ProcessStartInfo {
                    FileName = "cmd.exe",
                    Arguments = "/k \"\"" + node + "\" \"" + cliPath + "\" connect --background --startup\"",
                    WorkingDirectory = repoRoot,
                    UseShellExecute = true
                });
                OpenDashboard();
                activityBox.Text = "A pairing window is open. Copy its code into Crewboard > Devices > Connect device.";
            } catch (Exception error) {
                activityBox.Text = error.Message;
            }
        }

        private void BeginCodexLogin()
        {
            try {
                string node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
                if (!File.Exists(node)) node = "node.exe";
                Process.Start(new ProcessStartInfo {
                    FileName = "cmd.exe",
                    Arguments = "/k \"\"" + node + "\" \"" + cliPath + "\" codex-login\"",
                    WorkingDirectory = repoRoot,
                    UseShellExecute = true
                });
                activityBox.Text = "Codex sign-in is open. Finish in the browser, close that window, then click Restart.";
            } catch (Exception error) {
                activityBox.Text = error.Message;
            }
        }

        private void RunAction(string action)
        {
            if (busy) return;
            SetBusy(true);
            activityBox.Text = "Running " + action + "...";
            Refresh();
            try {
                activityBox.Text = InvokeCrewboard(action);
            } catch (Exception error) {
                activityBox.Text = error.Message;
                MessageBox.Show(this, error.Message, "Crewboard", MessageBoxButtons.OK, MessageBoxIcon.Error);
            } finally {
                busy = false;
                UseWaitCursor = false;
            }
            UpdateStatus(false);
        }

        private void OpenDashboard()
        {
            string url = "https://swarm-eight-azure.vercel.app";
            try {
                if (File.Exists(configPath)) {
                    Match match = Regex.Match(File.ReadAllText(configPath), "\\\"serverUrl\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
                    if (match.Success) url = match.Groups[1].Value;
                }
                Process.Start(url);
            } catch (Exception error) {
                activityBox.Text = "Could not open dashboard: " + error.Message;
            }
        }

        private void OpenLog()
        {
            try {
                Directory.CreateDirectory(Path.GetDirectoryName(logPath));
                if (!File.Exists(logPath)) File.WriteAllText(logPath, string.Empty);
                Process.Start("notepad.exe", "\"" + logPath + "\"");
            } catch (Exception error) {
                activityBox.Text = "Could not open log: " + error.Message;
            }
        }
    }
}
