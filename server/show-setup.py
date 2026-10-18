#!/usr/bin/env python3
# Refuses tool-captured output: credentials belong only in the owner's interactive terminal.
import json, os, pathlib, sys
if sys.platform!='linux' or os.geteuid()!=0 or not sys.stdout.isatty():
    raise SystemExit('Use your interactive root SSH terminal. Do not capture, redirect or paste credentials into a chat.')
p=pathlib.Path('/etc/mcp-pc-bridge/owner-setup.json');data=json.loads(p.read_text())
print('PRIVATE SETUP VALUES. Never publish, log, screenshot or send these values to an AI assistant.')
for name in ['mcpUrl','clientId','clientSecret','ownerPassword','deviceId','deviceToken']:print(name+': '+data[name])
print('The owner password is a separate MCP consent password, not your Windows, Linux or ChatGPT password.')
