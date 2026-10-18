//go:build windows

package main

import (
	"archive/zip"
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const pinnedNodeVersion = "v24.21.0"
const pinnedNodeArchive = "node-v24.21.0-win-x64.zip"

func ensureOpenSSH() error {
	if _, e1 := exec.LookPath("ssh.exe"); e1 == nil {
		if _, e2 := exec.LookPath("ssh-keygen.exe"); e2 == nil {
			fmt.Println("OpenSSH Client: OK")
			return nil
		}
	}
	return fmt.Errorf("OpenSSH Client is missing. Install it through Windows Optional Features, then resume setup as a normal user")
}

func download(url, dst string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: HTTP %s", url, resp.Status)
	}
	tmp := dst + ".part"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(f, resp.Body)
	syncErr := f.Sync()
	closeErr := f.Close()
	if copyErr != nil {
		os.Remove(tmp)
		return copyErr
	}
	if syncErr != nil {
		os.Remove(tmp)
		return syncErr
	}
	if closeErr != nil {
		os.Remove(tmp)
		return closeErr
	}
	_ = os.Remove(dst)
	return os.Rename(tmp, dst)
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func manifestHash(path, filename string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		fields := strings.Fields(s.Text())
		if len(fields) == 2 && fields[1] == filename && len(fields[0]) == 64 {
			return strings.ToLower(fields[0]), nil
		}
	}
	if err := s.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("%s not found in SHASUMS256.txt", filename)
}

func extractZipSafe(zipPath, root string) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer zr.Close()
	cleanRoot, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	for _, zf := range zr.File {
		dst := filepath.Join(cleanRoot, filepath.FromSlash(zf.Name))
		cleanDst, err := filepath.Abs(dst)
		if err != nil {
			return err
		}
		if cleanDst != cleanRoot && !strings.HasPrefix(cleanDst, cleanRoot+string(os.PathSeparator)) {
			return fmt.Errorf("unsafe zip path: %s", zf.Name)
		}
		if zf.FileInfo().IsDir() {
			if err := os.MkdirAll(cleanDst, 0700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(cleanDst), 0700); err != nil {
			return err
		}
		in, err := zf.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(cleanDst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0700)
		if err != nil {
			in.Close()
			return err
		}
		_, copyErr := io.Copy(out, in)
		in.Close()
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func ensureNode(c *Config) (string, error) {
	if node, e1 := exec.LookPath("node.exe"); e1 == nil {
		if npm, e2 := exec.LookPath("npm.cmd"); e2 == nil {
			version, err := exec.Command(node, "--version").Output()
			if err == nil && strings.HasPrefix(strings.TrimSpace(string(version)), "v24.") {
				c.NodePath = node
				fmt.Println("Node.js/npm: using existing Node 24 installation")
				return npm, nil
			}
		}
	}

	runtimeRoot := filepath.Join(stateDir(), "runtime")
	nodeDir := filepath.Join(runtimeRoot, strings.TrimSuffix(pinnedNodeArchive, ".zip"))
	nodePath := filepath.Join(nodeDir, "node.exe")
	npmPath := filepath.Join(nodeDir, "npm.cmd")
	if _, e1 := os.Stat(nodePath); e1 == nil {
		if _, e2 := os.Stat(npmPath); e2 == nil {
			c.NodePath = nodePath
			fmt.Println("Node.js/npm: using previously downloaded portable runtime")
			return npmPath, nil
		}
	}

	if err := os.MkdirAll(runtimeRoot, 0700); err != nil {
		return "", err
	}
	base := "https://nodejs.org/download/release/" + pinnedNodeVersion + "/"
	sums := filepath.Join(runtimeRoot, "SHASUMS256.txt")
	archive := filepath.Join(runtimeRoot, pinnedNodeArchive)
	fmt.Println("Node.js/npm: downloading verified portable", pinnedNodeVersion)
	if err := download(base+"SHASUMS256.txt", sums); err != nil {
		return "", err
	}
	if err := download(base+pinnedNodeArchive, archive); err != nil {
		return "", err
	}
	want, err := manifestHash(sums, pinnedNodeArchive)
	if err != nil {
		return "", err
	}
	got, err := sha256File(archive)
	if err != nil {
		return "", err
	}
	if got != want {
		return "", fmt.Errorf("Node.js archive SHA256 mismatch: expected %s got %s", want, got)
	}
	if err := extractZipSafe(archive, runtimeRoot); err != nil {
		return "", err
	}
	if _, err := os.Stat(nodePath); err != nil {
		return "", err
	}
	if _, err := os.Stat(npmPath); err != nil {
		return "", err
	}
	c.NodePath = nodePath
	fmt.Println("Node.js/npm: portable runtime installed and SHA256 verified")
	return npmPath, nil
}
