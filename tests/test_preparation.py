import base64, importlib.util, json, pathlib, sys, tempfile, unittest, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
config=load('configuration','server/configuration.py')
plugin=load('package_plugin','tools/package_plugin.py')
scan=load('public_tree','tools/check_public_tree.py')
ssh=load('ssh_helper','server/authorize-device.py')
sys.path.insert(0,str(ROOT/'server'))
wizard=load('wizard_install','server/wizard-install.py')
dependencies=load('dependency_check','tools/check_dependencies.py')
class PreparationTests(unittest.TestCase):
    def test_configuration_independent_secrets(self):
        relay,gateway,owner=config.generate('mcp.example.invalid','desktop')
        values=dict(x.split('=',1) for x in relay.splitlines())
        self.assertEqual(len(values),6);self.assertNotEqual(values['MCP_TOKEN'],values['DEVICE_TOKEN'])
        self.assertEqual(gateway['issuer'],'https://mcp.example.invalid')
        self.assertNotIn(owner['clientSecret'],json.dumps(gateway))
        self.assertNotIn(owner['ownerPassword'],json.dumps(gateway))
        self.assertNotEqual(config.generate('mcp.example.invalid')[2]['deviceToken'],owner['deviceToken'])
    def test_invalid_domains(self):
        for bad in ['', 'https://example.org', 'example.org/path','localhost','127.0.0.1','a..org','-a.org','a-.org','a.org\ncommand']:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):config.generate(bad)
    def test_invalid_device_ids(self):
        for bad in ['', '../bad','a b','x'*65]:
            with self.assertRaises(ValueError):config.generate('mcp.example.invalid',bad)
    def test_plugin_url_validation(self):
        self.assertEqual(plugin.validate_url('https://mcp.example.invalid/mcp'),'https://mcp.example.invalid/mcp')
        for bad in ['http://example.org/mcp','https://example.org/mcp?token=x','https://example.org:8443/mcp','https://example.org/path', 'https://'+'user:password'+'@example.org/mcp']:
            with self.assertRaises(ValueError):plugin.validate_url(bad)
    def test_plugin_archive_consistency(self):
        with tempfile.TemporaryDirectory() as d:
            path=plugin.package('https://other.example.invalid/mcp',pathlib.Path(d)/'plugin.zip')
            with zipfile.ZipFile(path) as z:
                for f in ['mcp.json','.mcp.json']:
                    m=json.loads(z.read(f));self.assertEqual(m['mcpServers']['desktop-bridge']['url'],'https://other.example.invalid/mcp')
                    self.assertNotIn('Authorization',z.read(f).decode())
                self.assertIn('LICENSE',z.namelist());self.assertIn('.codex-plugin/plugin.json',z.namelist())
    def test_plugin_provided_client_has_no_secret(self):
        with tempfile.TemporaryDirectory() as d:
            p=plugin.package('https://other.example.invalid/mcp',pathlib.Path(d)/'plugin.zip','synthetic-client')
            with zipfile.ZipFile(p) as z:
                for name in ['mcp.json','.mcp.json']:
                    obj=json.loads(z.read(name));auth=obj['mcpServers']['desktop-bridge']['extensions']['com.openai']['auth']
                    self.assertEqual(auth['client']['mode'],'provided');self.assertEqual(auth['baseScopes'],['desktop'])
                    self.assertNotIn('clientSecret',z.read(name).decode())
    def test_wizard_validates_before_install(self):
        self.assertEqual(wizard.validate_request('mcp.example.org','desktop','owner@example.org',None,None,True),'mcp.example.org')
        for params in [('mcp.example.invalid','desktop','owner@example.org',None,None,True),('mcp.example.org','../escape','owner@example.org',None,None,True),('mcp.example.org','desktop','owner@example.org',None,None,False),('mcp.example.org','desktop',None,'relative','/key',False),('mcp.example.org','desktop',None,'/cert',None,False)]:
            with self.assertRaises(ValueError):wizard.validate_request(*params)
    def test_plugin_metadata_matches(self):
        root=json.loads((ROOT/'plugin/plugin.json').read_text())
        legacy=json.loads((ROOT/'plugin/.codex-plugin/plugin.json').read_text())
        self.assertEqual(root['extensions']['com.openai']['interface'],legacy['interface'])
        self.assertLessEqual(len(legacy['interface']['shortDescription']),30)
    def test_restricted_public_key(self):
        blob=bytes.fromhex('0000000b7373682d6564323535313900000020')+bytes(32)
        line=ssh.restricted_key('ssh-ed25519 '+base64.b64encode(blob).decode()+' synthetic-test')
        self.assertIn('permitopen="127.0.0.1:8787"',line);self.assertIn('command="/bin/false"',line)
        with self.assertRaises(ValueError):ssh.restricted_key('ssh-rsa invalid')
    def test_scanner_reports_no_secret_values(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);token='gh'+'p_'+'X'*40;(root/'sample.txt').write_text(token)
            findings=scan.check(root);self.assertTrue(findings);self.assertNotIn(token,str(findings))
    def test_runtime_file_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);(root/'owner-setup.json').write_text('{}');self.assertTrue(scan.check(root))
    def test_reviewed_dependency_inventory(self):
        self.assertEqual(dependencies.check(),90)
    def test_unknown_license_and_version_are_rejected(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            for tree in dependencies.TREES:
                (root/tree).mkdir(parents=True)
                for name in ['package.json','package-lock.json']:shutil.copyfile(ROOT/tree/name,root/tree/name)
            (root/'licenses').mkdir()
            for name in ['npm-inventory.json','npm-THIRD-PARTY.txt']:shutil.copyfile(ROOT/'licenses'/name,root/'licenses'/name)
            lock=root/'windows/client/package-lock.json';original=json.loads(lock.read_text())
            for key,value in [('license','UNKNOWN'),('version','999.0.0'),('hasInstallScript',True),('resolved','file:unreviewed')]:
                changed=json.loads(json.dumps(original));changed['packages']['node_modules/ws'][key]=value;lock.write_text(json.dumps(changed))
                with self.assertRaises(ValueError):dependencies.check(root)
    def test_agent_sources_are_identical(self):
        for name in ['agent.mjs','safety.mjs','pc-tools.mjs']:
            self.assertEqual((ROOT/'windows/client'/name).read_bytes(),(ROOT/'server/stage1/src'/name).read_bytes())
if __name__=='__main__':unittest.main(verbosity=2)
