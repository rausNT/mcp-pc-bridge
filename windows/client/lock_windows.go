//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// An exclusive OS handle prevents simultaneous setup/configure/run, including
// concurrent GUI and CLI starts. Windows releases it even after a crash.
func acquireStateLock() (*os.File, error) {
	if err := os.MkdirAll(stateDir(), 0700); err != nil {
		return nil, err
	}
	name := filepath.Join(stateDir(), "supervisor.lock")
	p, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return nil, err
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, fmt.Errorf("this installation is busy or running; no second operation started: %w", err)
	}
	return os.NewFile(uintptr(h), name), nil
}
