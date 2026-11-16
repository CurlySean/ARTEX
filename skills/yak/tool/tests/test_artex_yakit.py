import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import weburp


class YakitEvidenceURLTest(unittest.TestCase):
    def test_local_yakit_scene_is_accepted_for_renderer(self):
        url = "http://127.0.0.1:8777/yakit?scene=r-test&token=test"
        self.assertEqual(weburp.scene_url(url).path, "/yakit")


if __name__ == "__main__":
    unittest.main()
