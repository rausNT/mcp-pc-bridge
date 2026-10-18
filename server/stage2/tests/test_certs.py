import hashlib, importlib.util, json, os, pathlib, ssl, subprocess, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('certs',pathlib.Path(__file__).parents[1]/'deploy/certs.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)

class CertificateTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='dc-cert-test-');self.p=pathlib.Path(self.temp.name)
        self.cert,self.key=self.make('first','mcp.example.invalid')
    def tearDown(self):self.temp.cleanup()
    def make(self,name,host):
        cert=self.p/(name+'.pem');key=self.p/(name+'.key')
        subprocess.run(['openssl','req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256',
          '-nodes','-days','3','-keyout',str(key),'-out',str(cert),'-subj','/CN='+host,
          '-addext','subjectAltName=DNS:'+host],check=True,capture_output=True)
        return cert,key
    def test_matching_pair(self):c.check_pair(self.cert,self.key)
    def test_wrong_hostname(self):
        cert,key=self.make('wrong','other.invalid')
        with self.assertRaises(RuntimeError):c.check_pair(cert,key)
    def test_wrong_private_key(self):
        _,key=self.make('second','mcp.example.invalid')
        with self.assertRaises(ssl.SSLError):c.check_pair(self.cert,key)
    def test_missing_source(self):
        with self.assertRaises(RuntimeError):c.check_pair(self.p/'missing',self.key)
    def test_parser_does_not_execute_shell(self):
        path=self.p/'acme.conf';path.write_text("Le_Domain='mcp.example.invalid'\nLe_Webroot='no'\nLe_ReloadCmd='echo SHOULD_NOT_RUN'\n")
        self.assertEqual(c.config_values(path)['Le_Webroot'],'no')
    def test_atomic_copy_unchanged_source_and_permissions(self):
        src=self.p/'source.json';src.write_text(json.dumps({'cert':str(self.cert),'key':str(self.key)}))
        tls=self.p/'tls';tls.mkdir();original=(self.cert.read_bytes(),self.key.read_bytes())
        with patch.object(c.os,'chown'):
            self.assertTrue(c.sync(src,tls,os.getgid(),False))
            self.assertFalse(c.sync(src,tls,os.getgid(),False))
            self.assertEqual((tls/'current/fullchain.pem').read_bytes(),original[0])
            self.assertEqual((tls/'current/privkey.pem').read_bytes(),original[1])
            self.assertEqual((tls/'current/privkey.pem').stat().st_mode&0o777,0o640)
        self.assertEqual((self.cert.read_bytes(),self.key.read_bytes()),original)
    def test_failed_rotation_keeps_previous_pair(self):
        src=self.p/'source.json';src.write_text(json.dumps({'cert':str(self.cert),'key':str(self.key)}))
        tls=self.p/'tls';tls.mkdir()
        with patch.object(c.os,'chown'):
            c.sync(src,tls,os.getgid(),False);previous=(tls/'current').readlink()
            self.key.write_text('invalid-key')
            with self.assertRaises(ssl.SSLError):c.sync(src,tls,os.getgid(),False)
            self.assertEqual((tls/'current').readlink(),previous)
    def test_rotation_moves_symlink_not_source(self):
        src=self.p/'source.json';src.write_text(json.dumps({'cert':str(self.cert),'key':str(self.key)}))
        tls=self.p/'tls';tls.mkdir()
        with patch.object(c.os,'chown'):
            c.sync(src,tls,os.getgid(),False);previous=(tls/'current').readlink()
            cert,key=self.make('new','mcp.example.invalid');src.write_text(json.dumps({'cert':str(cert),'key':str(key)}))
            c.sync(src,tls,os.getgid(),False)
            self.assertNotEqual((tls/'current').readlink(),previous)
            self.assertTrue((tls/previous).is_dir())
            self.assertEqual((tls/'current/fullchain.pem').read_bytes(),cert.read_bytes())
if __name__=='__main__':unittest.main(verbosity=2)
