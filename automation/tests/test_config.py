import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from store_ops.config import load_config


class ProjectConfigTests(unittest.TestCase):
    def test_nas_paths_can_override_local_relative_roots(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config_dir = root / "config"
            config_dir.mkdir()
            config_path = config_dir / "project.json"
            config_path.write_text(json.dumps({
                "data_root": "../local-data",
                "runtime_root": "runtime",
                "sku_pattern": "SKU",
                "ignore_values": [],
                "sources": [],
            }), encoding="utf-8")

            nas_data = root / "nas-sources"
            nas_runtime = root / "nas-runtime"
            with patch.dict(os.environ, {
                "STORE_OPS_DATA_ROOT": str(nas_data),
                "STORE_OPS_RUNTIME_ROOT": str(nas_runtime),
            }):
                config = load_config(config_path)

            self.assertEqual(config.data_root, nas_data.resolve())
            self.assertEqual(config.runtime_root, nas_runtime.resolve())


if __name__ == "__main__":
    unittest.main()
