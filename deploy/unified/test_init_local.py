from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('init-local.py')


class LocalStateTest(unittest.TestCase):
    def initialize(self, root):
        result = subprocess.run([sys.executable, str(SCRIPT), str(root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_new_install_generates_private_unique_credentials(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            keys = []
            passwords = []
            for folder in (first, second):
                root = Path(folder)
                result = self.initialize(root)
                environment = root / '.env'
                key = root / 'state/jwt.key'
                password = re.search(r'^POSTGRES_PASSWORD=(\w+)$', environment.read_text(), re.M).group(1)
                self.assertGreaterEqual(len(password), 48)
                self.assertRegex(key.read_bytes(), rb"^[0-9a-f]{64}$")
                self.assertEqual(environment.stat().st_mode & 0o777, 0o600)
                self.assertEqual(key.stat().st_mode & 0o777, 0o600)
                self.assertTrue((root / 'state/yak').is_dir())
                self.assertNotIn(password, result.stdout + result.stderr)
                keys.append(key.read_bytes())
                passwords.append(password)
            self.assertNotEqual(keys[0], keys[1])
            self.assertNotEqual(passwords[0], passwords[1])

    def test_repeat_initialization_preserves_existing_configuration_and_state(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.initialize(root)
            custom_env = 'POSTGRES_PASSWORD=custom_password\nARTEX_PORT=28787\n'
            (root / '.env').write_text(custom_env)
            key = (root / 'state/jwt.key').read_bytes()
            evidence = root / 'state/yak/evidence.json'
            evidence.write_text('{"id":"preserve-me"}')
            self.initialize(root)
            self.assertEqual((root / '.env').read_text(), custom_env)
            self.assertEqual((root / 'state/jwt.key').read_bytes(), key)
            self.assertEqual(evidence.read_text(), '{"id":"preserve-me"}')


if __name__ == '__main__':
    unittest.main()
