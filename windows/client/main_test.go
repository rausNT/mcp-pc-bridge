//go:build windows

package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUnconfiguredHostRejected(t *testing.T) {
	if validateConfig(defaultConfig()) == nil {
		t.Fatal("unconfigured host accepted")
	}
}
func TestExclusiveStateLockAndRelease(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	first, err := acquireStateLock()
	if err != nil {
		t.Fatal(err)
	}
	if second, err := acquireStateLock(); err == nil {
		second.Close()
		first.Close()
		t.Fatal("duplicate lock accepted")
	}
	first.Close()
	third, err := acquireStateLock()
	if err != nil {
		t.Fatal("lock not released", err)
	}
	third.Close()
}
func TestExplicitStateIsolation(t *testing.T) {
	old := stateOverride
	stateOverride = t.TempDir()
	defer func() { stateOverride = old }()
	c := defaultConfig()
	for _, p := range []string{c.SSHKey, c.AgentScript, c.ToolsScript} {
		if !strings.HasPrefix(p, stateOverride+string(os.PathSeparator)) {
			t.Fatal("path escapes explicit state", p)
		}
	}
}
func TestConfigurationValidation(t *testing.T) {
	c := defaultConfig()
	c.SSHHost = "mcp.example.org"
	if err := validateConfig(c); err != nil {
		t.Fatal(err)
	}
	for _, host := range []string{"", "-oProxyCommand=bad", "https://host.example", "host\ncommand", "mcp.example.invalid"} {
		x := c
		x.SSHHost = host
		if validateConfig(x) == nil {
			t.Fatalf("accepted %q", host)
		}
	}
	for _, id := range []string{"", "../escape", "a\nb", strings.Repeat("a", 65)} {
		x := c
		x.DeviceID = id
		if validateConfig(x) == nil {
			t.Fatalf("accepted device id %q", id)
		}
	}
}
func TestBOMConfigAndStateIsolation(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	t.Setenv("APPDATA", t.TempDir())
	c := defaultConfig()
	c.SSHHost = "mcp.example.org"
	if err := saveConfig(c); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(configPath())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(configPath(), append([]byte{0xef, 0xbb, 0xbf}, b...), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := loadConfig()
	if err != nil || got.SSHHost != c.SSHHost {
		t.Fatalf("BOM config: %v", err)
	}
	if filepath.Base(stateDir()) != "MCP PC Bridge" {
		t.Fatal("unexpected state directory")
	}
	if _, err = os.Stat(startupScriptPath()); !os.IsNotExist(err) {
		t.Fatal("configuration enabled autostart")
	}
}
func TestDPAPIRoundTrip(t *testing.T) {
	input := []byte("temporary test data; not a credential")
	cipher, err := protect(input)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := unprotect(cipher)
	if err != nil || !bytes.Equal(input, plain) {
		t.Fatalf("DPAPI roundtrip: %v", err)
	}
}
func TestZipTraversalRejected(t *testing.T) {
	root := t.TempDir()
	archive := filepath.Join(root, "bad.zip")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(f)
	entry, err := z.Create("../escaped.txt")
	if err != nil {
		t.Fatal(err)
	}
	entry.Write([]byte("test"))
	z.Close()
	f.Close()
	if extractZipSafe(archive, filepath.Join(root, "extract")) == nil {
		t.Fatal("path traversal accepted")
	}
	if _, err = os.Stat(filepath.Join(root, "escaped.txt")); !os.IsNotExist(err) {
		t.Fatal("escaped file exists")
	}
}
func TestPortableBootstrapIntegration(t *testing.T) {
	if os.Getenv("MCP_BRIDGE_TEST_BOOTSTRAP") != "1" {
		t.Skip("explicit network/bootstrap opt-in required")
	}
	old := stateOverride
	stateOverride = t.TempDir()
	defer func() { stateOverride = old }()
	// Exclude installed Node/npm while retaining only Windows/OpenSSH utilities.
	win := os.Getenv("WINDIR")
	t.Setenv("PATH", filepath.Join(win, "System32", "OpenSSH")+";"+filepath.Join(win, "System32"))
	if err := configure("mcp.example.org", "bootstrap-test"); err != nil {
		t.Fatal(err)
	}
	if err := setupWithToken(strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	c, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(c.NodePath, filepath.Join(stateDir(), "runtime")) {
		t.Fatal("portable Node was not installed")
	}
	for _, path := range []string{c.SSHKey, c.SSHKey + ".pub", c.AgentScript, c.ToolsScript, tokenPath()} {
		if _, err := os.Stat(path); err != nil {
			t.Fatal(err)
		}
	}
	value, err := token()
	if err != nil || value != strings.Repeat("a", 64) {
		t.Fatal("DPAPI setup failed")
	}
}
