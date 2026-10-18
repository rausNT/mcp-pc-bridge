//go:build windows

package main

import (
	"bufio"
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed agent.mjs
var embeddedAgent []byte

//go:embed safety.mjs
var embeddedSafety []byte

//go:embed pc-tools.mjs
var embeddedPcTools []byte

//go:embed package.json
var embeddedPackage []byte

//go:embed package-lock.json
var embeddedPackageLock []byte

type Config struct {
	SSHHost     string `json:"sshHost"`
	SSHUser     string `json:"sshUser"`
	SSHKey      string `json:"sshKey"`
	LocalPort   int    `json:"localPort"`
	DeviceID    string `json:"deviceId"`
	DeviceName  string `json:"deviceName"`
	NodePath    string `json:"nodePath"`
	AgentScript string `json:"agentScript"`
	ToolsScript string `json:"toolsScript"`
}

func localAppData() string {
	if v := os.Getenv("LOCALAPPDATA"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "AppData", "Local")
}

var stateOverride string

func stateDir() string {
	if stateOverride != "" {
		return stateOverride
	}
	return filepath.Join(localAppData(), "MCP PC Bridge")
}
func configPath() string { return filepath.Join(stateDir(), "config.json") }
func tokenPath() string  { return filepath.Join(stateDir(), "device-token.dpapi") }
func defaultConfig() Config {
	return Config{
		SSHHost: "", SSHUser: "mcp-pc-bridge-agent", LocalPort: 18890,
		DeviceID: "desktop", DeviceName: "Desktop",
		SSHKey:      filepath.Join(stateDir(), "ssh", "id_ed25519_pc_bridge"),
		NodePath:    "node.exe",
		AgentScript: filepath.Join(stateDir(), "agent.mjs"),
		ToolsScript: filepath.Join(stateDir(), "pc-tools.mjs"),
	}
}
func loadConfig() (Config, error) {
	b, e := os.ReadFile(configPath())
	if e != nil {
		return Config{}, e
	}
	b = bytes.TrimPrefix(b, []byte{0xEF, 0xBB, 0xBF})
	var c Config
	e = json.Unmarshal(b, &c)
	return c, e
}
func saveConfig(c Config) error {
	if err := os.MkdirAll(stateDir(), 0700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(configPath(), b, 0600)
}
func findExe(name string) (string, error) { return exec.LookPath(name) }
func ensureKey(c Config) error {
	if _, e := os.Stat(c.SSHKey); e == nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(c.SSHKey), 0700); err != nil {
		return err
	}
	keygen, e := findExe("ssh-keygen.exe")
	if e != nil {
		return e
	}
	cmd := exec.Command(keygen, "-t", "ed25519", "-N", "", "-f", c.SSHKey, "-C", "mcp-pc-bridge-desktop")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
func setupWithToken(rawToken string) error {
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(strings.TrimSpace(rawToken)) {
		return errors.New("device token must be 64 lowercase hex characters")
	}
	lock, err := acquireStateLock()
	if err != nil {
		return err
	}
	defer lock.Close()
	c := defaultConfig()
	if old, e := loadConfig(); e == nil {
		c = old
	}
	if err := validateConfig(c); err != nil {
		return err
	}
	c.AgentScript = filepath.Join(stateDir(), "agent.mjs")
	c.ToolsScript = filepath.Join(stateDir(), "pc-tools.mjs")
	if err := ensureOpenSSH(); err != nil {
		return err
	}
	npm, err := ensureNode(&c)
	if err != nil {
		return err
	}
	if err := ensureKey(c); err != nil {
		return err
	}
	token := strings.TrimSpace(rawToken)
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(token) {
		return errors.New("device token must be 64 lowercase hex characters")
	}
	enc, err := protect([]byte(token))
	if err != nil {
		return err
	}
	if err = os.MkdirAll(stateDir(), 0700); err != nil {
		return err
	}
	if err = os.WriteFile(tokenPath(), enc, 0600); err != nil {
		return err
	}
	if err = os.WriteFile(c.AgentScript, embeddedAgent, 0600); err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(stateDir(), "safety.mjs"), embeddedSafety, 0600); err != nil {
		return err
	}
	if err = os.WriteFile(c.ToolsScript, embeddedPcTools, 0600); err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(stateDir(), "package.json"), embeddedPackage, 0600); err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(stateDir(), "package-lock.json"), embeddedPackageLock, 0600); err != nil {
		return err
	}
	npmCLI := filepath.Join(filepath.Dir(npm), "node_modules", "npm", "bin", "npm-cli.js")
	if _, err = os.Stat(npmCLI); err != nil {
		return fmt.Errorf("npm CLI not found beside npm.cmd: %w", err)
	}
	installCmd := exec.Command(c.NodePath, npmCLI, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund")
	installCmd.Dir = stateDir()
	installCmd.Stdout = os.Stdout
	installCmd.Stderr = os.Stderr
	if err = installCmd.Run(); err != nil {
		return fmt.Errorf("npm install failed: %w", err)
	}
	if _, err = os.Stat(c.ToolsScript); err != nil {
		return fmt.Errorf("PC tools install incomplete: %w", err)
	}
	if err = saveConfig(c); err != nil {
		return err
	}
	return printPubKey(c)
}
func validateConfig(c Config) error {
	if !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$`).MatchString(c.SSHHost) || strings.HasSuffix(c.SSHHost, ".invalid") {
		return errors.New("configure your own SSH host first: pc-bridge-core.exe configure HOST [DEVICE-ID]")
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`).MatchString(c.DeviceID) {
		return errors.New("invalid device id")
	}
	if c.SSHUser != "mcp-pc-bridge-agent" {
		return errors.New("use the restricted mcp-pc-bridge-agent SSH account")
	}
	if c.LocalPort < 1024 || c.LocalPort > 65535 {
		return errors.New("invalid local port")
	}
	return nil
}
func configure(host, id string) error {
	lock, err := acquireStateLock()
	if err != nil {
		return err
	}
	defer lock.Close()
	c := defaultConfig()
	if old, e := loadConfig(); e == nil {
		c = old
	}
	c.SSHHost = host
	c.DeviceID = id
	if name, e := os.Hostname(); e == nil {
		c.DeviceName = name
	}
	if e := validateConfig(c); e != nil {
		return e
	}
	if e := saveConfig(c); e != nil {
		return e
	}
	fmt.Println("Configuration saved:", configPath(), ". No connection started.")
	return nil
}
func readSecret() (string, error) {
	k := syscall.NewLazyDLL("kernel32.dll")
	get := k.NewProc("GetConsoleMode")
	set := k.NewProc("SetConsoleMode")
	h := os.Stdin.Fd()
	var mode uint32
	ok, _, _ := get.Call(h, uintptr(unsafe.Pointer(&mode)))
	if ok != 0 {
		changed, _, err := set.Call(h, uintptr(mode&^0x0004))
		if changed == 0 {
			return "", err
		}
		defer set.Call(h, uintptr(mode))
	}
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	fmt.Println()
	return strings.TrimSpace(line), err
}
func setup() error {
	c, e := loadConfig()
	if e != nil {
		return errors.New("run configure before setup")
	}
	if e = validateConfig(c); e != nil {
		return e
	}
	fmt.Println("EXPERIMENTAL: grants remote file access and command execution as your Windows user. No folder sandbox or per-action approval is implemented.")
	fmt.Print("DEVICE_TOKEN (hidden console input; stored with Windows DPAPI): ")
	token, e := readSecret()
	if e != nil {
		return e
	}
	return setupWithToken(token)
}
func setupFromEnv() error {
	token := os.Getenv("DEVICE_TOKEN")
	if strings.TrimSpace(token) == "" {
		return errors.New("DEVICE_TOKEN environment variable is missing")
	}
	fmt.Println("Using DEVICE_TOKEN from the current process environment; its value will not be printed.")
	return setupWithToken(token)
}
func printPubKey(c Config) error {
	pub, err := os.ReadFile(c.SSHKey + ".pub")
	if err != nil {
		return err
	}
	fmt.Println("\nSSH public key. Add this ONE line to the VPS mcp-pc-bridge-agent authorized_keys using the server helper:")
	fmt.Println(strings.TrimSpace(string(pub)))
	fmt.Println("\nConfig:", configPath())
	return nil
}
func token() (string, error) {
	b, e := os.ReadFile(tokenPath())
	if e != nil {
		return "", e
	}
	d, e := unprotect(b)
	return string(d), e
}
func startSSH(c Config) (*exec.Cmd, error) {
	ssh, e := findExe("ssh.exe")
	if e != nil {
		return nil, e
	}
	args := []string{"-N", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-i", c.SSHKey, "-L", fmt.Sprintf("127.0.0.1:%d:127.0.0.1:8787", c.LocalPort), c.SSHUser + "@" + c.SSHHost}
	cmd := exec.Command(ssh, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd, cmd.Start()
}
func waitPort(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 300*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	return errors.New("SSH local forward did not become ready")
}
func startAgent(c Config, tok string) (*exec.Cmd, error) {
	node := c.NodePath
	if filepath.Base(strings.ToLower(node)) == strings.ToLower(node) {
		if p, e := findExe(node); e == nil {
			node = p
		}
	}
	if _, e := os.Stat(c.AgentScript); e != nil {
		return nil, fmt.Errorf("agent script not found: %s", c.AgentScript)
	}
	if _, e := os.Stat(c.ToolsScript); e != nil {
		return nil, fmt.Errorf("PC tools script not found: %s", c.ToolsScript)
	}
	cmd := exec.Command(node, c.AgentScript)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	cmd.Env = append(os.Environ(), "DEVICE_TOKEN="+tok, "DEVICE_ID="+c.DeviceID, "DEVICE_NAME="+c.DeviceName,
		"RELAY_URL=ws://127.0.0.1:"+strconv.Itoa(c.LocalPort)+"/device/ws", "DC_REMOTE_CONFIG="+filepath.Join(stateDir(), "agent.json"))
	return cmd, cmd.Start()
}
func runBridge() error {
	lock, err := acquireStateLock()
	if err != nil {
		return err
	}
	defer lock.Close()
	c, e := loadConfig()
	if e != nil {
		return fmt.Errorf("run setup first: %w", e)
	}
	if e = validateConfig(c); e != nil {
		return e
	}
	probe, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", c.LocalPort))
	if err != nil {
		return errors.New("local port is already occupied; no connection started")
	}
	probe.Close()
	fmt.Println("REMOTE COMMAND ACCESS ENABLED. Keep this window visible. Ctrl+C disconnects; already-started external processes may continue.")
	tok, e := token()
	if e != nil {
		return fmt.Errorf("cannot decrypt device token: %w", e)
	}
	ssh, e := startSSH(c)
	if e != nil {
		return e
	}
	defer func() { _ = ssh.Process.Kill() }()
	if e = waitPort(c.LocalPort, 10*time.Second); e != nil {
		return e
	}
	agent, e := startAgent(c, tok)
	if e != nil {
		return e
	}
	defer func() { _ = agent.Process.Kill() }()
	fmt.Println("MCP PC Bridge bridge running. SSH PID", ssh.Process.Pid, "Agent PID", agent.Process.Pid)
	sig := make(chan os.Signal, 2)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	done := make(chan error, 2)
	go func() { done <- ssh.Wait() }()
	go func() { done <- agent.Wait() }()
	select {
	case <-sig:
		return nil
	case e := <-done:
		return fmt.Errorf("child process stopped: %w", e)
	}
}
func startupScriptPath() string {
	appData := os.Getenv("APPDATA")
	return filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "MCP PC Bridge.vbs")
}
func installStartup() error {
	c, e := loadConfig()
	if e != nil {
		return e
	}
	if e = validateConfig(c); e != nil {
		return e
	}
	fmt.Println("Enabling visible per-user logon startup. Use uninstall-startup to remove it.")
	exe, e := os.Executable()
	if e != nil {
		return e
	}
	path := startupScriptPath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	script := "Set sh = CreateObject(\"WScript.Shell\")\r\n" +
		"sh.Run Chr(34) & \"" + strings.ReplaceAll(exe, "\"", "\"\"") + "\" & Chr(34) & \" --state-dir \" & Chr(34) & \"" + strings.ReplaceAll(stateDir(), "\"", "\"\"") + "\" & Chr(34) & \" run\", 1, False\r\n"
	return os.WriteFile(path, []byte(script), 0600)
}
func uninstallStartup() error {
	err := os.Remove(startupScriptPath())
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
func status() error {
	c, e := loadConfig()
	if e != nil {
		return e
	}
	fmt.Println("CONFIGURATION ONLY: not a live connection check.")
	fmt.Println("config:", configPath())
	fmt.Println("server:", c.SSHUser+"@"+c.SSHHost, "local port:", c.LocalPort)
	if _, e = os.Stat(tokenPath()); e == nil {
		fmt.Println("device token: DPAPI file present")
	} else {
		fmt.Println("device token: missing")
	}
	return nil
}
func main() {
	if len(os.Args) >= 3 && os.Args[1] == "--state-dir" {
		if !filepath.IsAbs(os.Args[2]) {
			fmt.Fprintln(os.Stderr, "--state-dir must be absolute")
			os.Exit(2)
		}
		stateOverride = filepath.Clean(os.Args[2])
		os.Args = append(os.Args[:1], os.Args[3:]...)
	}
	if len(os.Args) < 2 {
		fmt.Println("Usage: pc-bridge-core.exe configure HOST [DEVICE-ID] | setup | setup-from-env | pubkey | run | status | install-startup | uninstall-startup | version")
		os.Exit(2)
	}
	var e error
	switch os.Args[1] {
	case "configure":
		if len(os.Args) < 3 || len(os.Args) > 4 {
			e = errors.New("configure HOST [DEVICE-ID]")
		} else {
			id := "desktop"
			if len(os.Args) == 4 {
				id = os.Args[3]
			}
			e = configure(os.Args[2], id)
		}
	case "version":
		fmt.Println("MCP PC Bridge 0.2.0-preview.1")
	case "setup":
		e = setup()
	case "setup-from-env":
		e = setupFromEnv()
	case "pubkey":
		c, err := loadConfig()
		if err != nil {
			e = err
		} else {
			e = printPubKey(c)
		}
	case "run":
		e = runBridge()
	case "status":
		e = status()
	case "install-startup":
		e = installStartup()
	case "uninstall-startup":
		e = uninstallStartup()
	default:
		e = errors.New("unknown command")
	}
	if e != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", e)
		os.Exit(1)
	}
}
